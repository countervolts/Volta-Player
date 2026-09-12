// alac packet decoder

#include <stdint.h>

#define VOLTA_ALAC_MAX_CHANNELS 8
#define VOLTA_ALAC_MAX_FRAME_SAMPLES 65536

#define ALAC_OK 0
#define ALAC_INVALID -1
#define ALAC_UNSUPPORTED -2
#define ALAC_OVERFLOW -3

typedef struct {
  const uint8_t *data;
  uint32_t length;
  uint32_t position;
  int32_t error;
} BitReader;

typedef struct {
  uint32_t bit_depth;
  uint32_t history_mult;
  uint32_t initial_history;
  uint32_t rice_limit;
  uint32_t channels;
  uint32_t frame_length;
} AlacConfig;

static int32_t mix[2][VOLTA_ALAC_MAX_FRAME_SAMPLES];
static int32_t residual[VOLTA_ALAC_MAX_FRAME_SAMPLES];
static uint16_t shifted[2][VOLTA_ALAC_MAX_FRAME_SAMPLES];

static uint32_t br_left(const BitReader *reader) {
  const uint32_t total = reader->length * 8u;
  return reader->position < total ? total - reader->position : 0;
}

static uint32_t br_read(BitReader *reader, uint32_t bits) {
  uint32_t value = 0;
  uint32_t i;
  if (bits > 32u || br_left(reader) < bits) {
    reader->error = ALAC_INVALID;
    return 0;
  }
  for (i = 0; i < bits; ++i) {
    const uint32_t byte_index = reader->position >> 3;
    const uint32_t bit_index = 7u - (reader->position & 7u);
    value = (value << 1u) | ((reader->data[byte_index] >> bit_index) & 1u);
    reader->position++;
  }
  return value;
}

static int32_t br_signed(BitReader *reader, uint32_t bits) {
  uint32_t value;
  if (!bits || bits > 32u) {
    reader->error = ALAC_INVALID;
    return 0;
  }
  value = br_read(reader, bits);
  if (bits == 32u) return (int32_t)value;
  if (value & (1u << (bits - 1u))) value |= ~((1u << bits) - 1u);
  return (int32_t)value;
}

static void br_skip(BitReader *reader, uint32_t bits) {
  if (br_left(reader) < bits) {
    reader->error = ALAC_INVALID;
    return;
  }
  reader->position += bits;
}

static void br_align(BitReader *reader) {
  const uint32_t remainder = reader->position & 7u;
  if (remainder) br_skip(reader, 8u - remainder);
}

static uint32_t log2_floor(uint32_t value) {
  uint32_t result = 0;
  while (value > 1u) {
    value >>= 1u;
    result++;
  }
  return result;
}

static uint32_t leading_zeroes(uint32_t value) {
  uint32_t count = 0;
  if (!value) return 32u;
  while ((value & 0x80000000u) == 0u) {
    value <<= 1u;
    count++;
  }
  return count;
}

static int32_t sign_only(int32_t value) {
  return (value > 0) - (value < 0);
}

static int32_t sign_extend(int64_t value, uint32_t bits) {
  uint32_t packed;
  if (bits == 32u) return (int32_t)value;
  packed = (uint32_t)value & ((1u << bits) - 1u);
  if (packed & (1u << (bits - 1u))) packed |= ~((1u << bits) - 1u);
  return (int32_t)packed;
}

// ALAC's adaptive Golomb scalar. Its unary prefix is a run of one-bits.
static uint32_t rice_scalar(
  BitReader *reader,
  uint32_t divisor,
  uint32_t parameter,
  uint32_t raw_bits
) {
  uint32_t prefix = 0;
  uint32_t start = reader->position;
  uint32_t value;

  while (prefix < 9u && br_left(reader)) {
    if (!br_read(reader, 1u)) break;
    prefix++;
  }
  if (reader->error) return 0;
  if (prefix >= 9u) return br_read(reader, raw_bits);
  if (parameter == 1u) return prefix * divisor;

  value = br_read(reader, parameter);
  if (reader->error) return 0;
  if (value >= 2u) return prefix * divisor + value - 1u;

  // ALAC stores the short remainder by borrowing the terminator bit.
  reader->position = start + prefix + parameter;
  return prefix * divisor;
}

static int32_t decode_residuals(
  BitReader *reader,
  int32_t *destination,
  uint32_t samples,
  uint32_t bits_per_sample,
  uint32_t initial_history,
  uint32_t history_mult,
  uint32_t rice_limit
) {
  uint32_t history = initial_history;
  uint32_t zero_modifier = 0;
  uint32_t index = 0;

  while (index < samples) {
    uint32_t parameter;
    uint32_t divisor;
    uint32_t coded;
    int32_t signed_value;

    parameter = log2_floor((history >> 9u) + 3u);
    if (parameter > rice_limit) parameter = rice_limit;
    divisor = parameter ? ((1u << parameter) - 1u) : 0u;
    coded = rice_scalar(reader, divisor, parameter, bits_per_sample);
    if (reader->error) return reader->error;
    coded += zero_modifier;
    zero_modifier = 0;
    signed_value = (int32_t)((coded >> 1u) ^ (uint32_t)-(int32_t)(coded & 1u));
    destination[index++] = signed_value;

    if (coded > 0xffffu) {
      history = 0xffffu;
    } else {
      history += coded * history_mult - ((history * history_mult) >> 9u);
    }

    if ((history << 2u) < 512u && index < samples) {
      uint32_t zero_parameter = leading_zeroes(history) - 24u + ((history + 16u) >> 6u);
      uint32_t zero_divisor;
      uint32_t zero_count;
      if (zero_parameter > rice_limit) zero_parameter = rice_limit;
      zero_divisor = zero_parameter ? ((1u << zero_parameter) - 1u) : 0u;
      zero_count = rice_scalar(reader, zero_divisor, zero_parameter, 16u);
      if (reader->error || zero_count > samples - index) return ALAC_INVALID;
      while (zero_count--) destination[index++] = 0;
      zero_modifier = 1u;
      history = 0;
    }
  }
  return ALAC_OK;
}

static void restore_predictor(
  const int32_t *errors,
  int32_t *destination,
  uint32_t samples,
  uint32_t bits_per_sample,
  int16_t *coefficients,
  uint32_t order,
  uint32_t quant
) {
  uint32_t index;
  if (!samples) return;
  destination[0] = errors[0];
  if (samples == 1u) return;
  if (order == 0u) {
    for (index = 1u; index < samples; ++index) destination[index] = errors[index];
    return;
  }
  if (order == 31u) {
    for (index = 1u; index < samples; ++index)
      destination[index] = sign_extend((int64_t)destination[index - 1u] + errors[index], bits_per_sample);
    return;
  }

  for (index = 1u; index <= order && index < samples; ++index)
    destination[index] = sign_extend((int64_t)destination[index - 1u] + errors[index], bits_per_sample);

  for (; index < samples; ++index) {
    uint32_t coefficient_index;
    int64_t prediction = 0;
    int32_t base = destination[index - order - 1u];
    int32_t remaining = errors[index];
    for (coefficient_index = 0u; coefficient_index < order; ++coefficient_index)
      prediction += (int64_t)(destination[index - 1u - coefficient_index] - base) * coefficients[coefficient_index];
    prediction = (prediction + ((int64_t)1 << (quant - 1u))) >> quant;
    destination[index] = sign_extend(prediction + base + remaining, bits_per_sample);

    if (remaining) {
      const int32_t error_direction = sign_only(remaining);
      for (coefficient_index = order; coefficient_index > 0u; --coefficient_index) {
        const uint32_t coefficient = coefficient_index - 1u;
        const int32_t difference = base - destination[index - 1u - coefficient];
        const int32_t direction = sign_only(difference);
        if (error_direction > 0) {
          coefficients[coefficient] -= (int16_t)direction;
          remaining -= (int32_t)(((int64_t)direction * difference >> quant) * (order - coefficient));
          if (remaining <= 0) break;
        } else {
          coefficients[coefficient] += (int16_t)direction;
          remaining -= (int32_t)(((int64_t)-direction * difference >> quant) * (order - coefficient));
          if (remaining >= 0) break;
        }
      }
    }
  }
}

static int32_t decode_element(
  BitReader *reader,
  const AlacConfig *config,
  uint32_t element_channels,
  uint32_t output_channel,
  int32_t *output,
  uint32_t output_capacity,
  uint32_t *frame_samples
) {
  uint32_t has_size;
  uint32_t byte_shift;
  uint32_t compressed;
  uint32_t samples;
  uint32_t bits_per_channel;
  uint32_t mix_shift = 0;
  uint32_t mix_weight = 0;
  uint32_t channel;
  int16_t coefficients[2][32];
  uint32_t orders[2];
  uint32_t quants[2];
  uint32_t modes[2];
  uint32_t rice_factors[2];

  br_skip(reader, 4u);
  br_skip(reader, 12u);
  has_size = br_read(reader, 1u);
  byte_shift = br_read(reader, 2u);
  compressed = !br_read(reader, 1u);
  if (reader->error || byte_shift > 2u) return ALAC_INVALID;
  samples = has_size ? br_read(reader, 32u) : config->frame_length;
  if (reader->error || !samples || samples > VOLTA_ALAC_MAX_FRAME_SAMPLES || samples > output_capacity)
    return ALAC_OVERFLOW;
  if (*frame_samples && *frame_samples != samples) return ALAC_INVALID;
  *frame_samples = samples;
  bits_per_channel = config->bit_depth - byte_shift * 8u + element_channels - 1u;
  if (!bits_per_channel || bits_per_channel > 32u) return ALAC_UNSUPPORTED;

  if (compressed) {
    mix_shift = br_read(reader, 8u);
    mix_weight = br_read(reader, 8u);
    if (element_channels == 2u && mix_weight && mix_shift > 31u) return ALAC_INVALID;
    for (channel = 0u; channel < element_channels; ++channel) {
      uint32_t coefficient;
      modes[channel] = br_read(reader, 4u);
      quants[channel] = br_read(reader, 4u);
      rice_factors[channel] = br_read(reader, 3u);
      orders[channel] = br_read(reader, 5u);
      if (!quants[channel] || orders[channel] >= samples) return ALAC_INVALID;
      for (coefficient = 0u; coefficient < orders[channel]; ++coefficient)
        coefficients[channel][coefficient] = (int16_t)br_signed(reader, 16u);
    }
    if (reader->error) return reader->error;

    if (byte_shift) {
      const uint32_t low_bits = byte_shift * 8u;
      for (uint32_t index = 0u; index < samples; ++index)
        for (channel = 0u; channel < element_channels; ++channel)
          shifted[channel][index] = (uint16_t)br_read(reader, low_bits);
    }
    if (reader->error) return reader->error;

    for (channel = 0u; channel < element_channels; ++channel) {
      const uint32_t history_mult = (rice_factors[channel] * config->history_mult) >> 2u;
      int32_t status = decode_residuals(
        reader,
        residual,
        samples,
        bits_per_channel,
        config->initial_history,
        history_mult,
        config->rice_limit
      );
      if (status) return status;
      if (modes[channel] == 15u)
        restore_predictor(residual, residual, samples, bits_per_channel, coefficients[channel], 31u, 0u);
      else if (modes[channel] != 0u)
        return ALAC_UNSUPPORTED;
      restore_predictor(
        residual,
        mix[channel],
        samples,
        bits_per_channel,
        coefficients[channel],
        orders[channel],
        quants[channel]
      );
    }
  } else {
    byte_shift = 0u;
    mix_shift = 0u;
    mix_weight = 0u;
    for (uint32_t index = 0u; index < samples; ++index)
      for (channel = 0u; channel < element_channels; ++channel)
        mix[channel][index] = br_signed(reader, config->bit_depth);
    if (reader->error) return reader->error;
  }

  for (uint32_t index = 0u; index < samples; ++index) {
    int32_t first = mix[0][index];
    int32_t second = element_channels == 2u ? mix[1][index] : 0;
    if (element_channels == 2u && mix_weight) {
      first = first + second - (int32_t)(((int64_t)mix_weight * second) >> mix_shift);
      second = first - second;
    }
    if (byte_shift) {
      first = (int32_t)(((uint32_t)first << (byte_shift * 8u)) | shifted[0][index]);
      if (element_channels == 2u)
        second = (int32_t)(((uint32_t)second << (byte_shift * 8u)) | shifted[1][index]);
    }
    output[index * config->channels + output_channel] = first;
    if (element_channels == 2u) output[index * config->channels + output_channel + 1u] = second;
  }
  return ALAC_OK;
}

// Return decoded frame count, or a negative ALAC_* error code.
int32_t volta_alac_decode_packet(
  uint32_t packet_pointer,
  uint32_t packet_length,
  uint32_t bit_depth,
  uint32_t history_mult,
  uint32_t initial_history,
  uint32_t rice_limit,
  uint32_t channels,
  uint32_t frame_length,
  uint32_t output_pointer,
  uint32_t output_capacity
) {
  const AlacConfig config = {
    bit_depth,
    history_mult,
    initial_history,
    rice_limit,
    channels,
    frame_length,
  };
  BitReader reader = {
    (const uint8_t *)(uintptr_t)packet_pointer,
    packet_length,
    0u,
    ALAC_OK,
  };
  int32_t *output = (int32_t *)(uintptr_t)output_pointer;
  uint32_t channel_index = 0u;
  uint32_t samples = 0u;

  if (!packet_pointer || !packet_length || !output_pointer ||
      !channels || channels > VOLTA_ALAC_MAX_CHANNELS ||
      !frame_length || frame_length > VOLTA_ALAC_MAX_FRAME_SAMPLES ||
      (bit_depth != 16u && bit_depth != 20u && bit_depth != 24u && bit_depth != 32u))
    return ALAC_UNSUPPORTED;

  while (br_left(&reader) >= 3u) {
    const uint32_t element = br_read(&reader, 3u);
    uint32_t element_channels;
    int32_t status;
    if (reader.error) return reader.error;
    if (element == 7u) {
      br_align(&reader);
      return reader.error ? reader.error : (int32_t)samples;
    }
    if (element == 4u) {
      uint32_t count;
      br_skip(&reader, 4u);
      if (br_read(&reader, 1u)) br_align(&reader);
      count = br_read(&reader, 8u);
      if (count == 255u) count += br_read(&reader, 8u);
      br_skip(&reader, count * 8u);
      if (reader.error) return reader.error;
      continue;
    }
    if (element == 6u) {
      uint32_t count = br_read(&reader, 4u);
      if (count == 15u) count += br_read(&reader, 8u) - 1u;
      br_skip(&reader, count * 8u);
      if (reader.error) return reader.error;
      continue;
    }
    if (element != 0u && element != 1u && element != 3u) return ALAC_UNSUPPORTED;
    element_channels = element == 1u ? 2u : 1u;
    if (channel_index + element_channels > channels) return ALAC_INVALID;
    status = decode_element(
      &reader,
      &config,
      element_channels,
      channel_index,
      output,
      output_capacity,
      &samples
    );
    if (status) return status;
    channel_index += element_channels;
  }
  return ALAC_INVALID;
}

extern unsigned char __heap_base;

uint32_t volta_alac_heap_base(void) {
  return (uint32_t)(uintptr_t)&__heap_base;
}
