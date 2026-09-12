// mpeg-4 AAC-LC ADTS decoder.

#include <stdint.h>

#define VOLTA_AAC_MAX_CHANNELS 2
#define VOLTA_AAC_FRAME_SAMPLES 1024
#define VOLTA_AAC_TRANSFORM_SAMPLES 2048
#define VOLTA_AAC_MAX_SFB 51

#define AAC_OK 0
#define AAC_INVALID -1
#define AAC_UNSUPPORTED -2
#define AAC_OVERFLOW -3

typedef struct {
  const uint8_t *data;
  uint32_t length;
  uint32_t position;
  int32_t error;
} BitReader;

typedef struct {
  uint32_t max_sfb;
  uint8_t codebook[VOLTA_AAC_MAX_SFB];
  int16_t scale[VOLTA_AAC_MAX_SFB];
} IcsInfo;

typedef struct {
  uint32_t sample_rate;
  uint32_t channels;
  uint32_t payload_offset;
  uint32_t payload_length;
} AdtsFrame;

/* Tables below are the normative AAC noiseless-code codewords. */
typedef struct {
  const uint32_t *codes;
  const uint8_t *bits;
  uint16_t size;
} HuffmanTable;

const uint32_t scalefactor_codes[121] = {
    0x3ffe8, 0x3ffe6, 0x3ffe7, 0x3ffe5, 0x7fff5, 0x7fff1, 0x7ffed, 0x7fff6,
    0x7ffee, 0x7ffef, 0x7fff0, 0x7fffc, 0x7fffd, 0x7ffff, 0x7fffe, 0x7fff7,
    0x7fff8, 0x7fffb, 0x7fff9, 0x3ffe4, 0x7fffa, 0x3ffe3, 0x1ffef, 0x1fff0,
    0x0fff5, 0x1ffee, 0x0fff2, 0x0fff3, 0x0fff4, 0x0fff1, 0x07ff6, 0x07ff7,
    0x03ff9, 0x03ff5, 0x03ff7, 0x03ff3, 0x03ff6, 0x03ff2, 0x01ff7, 0x01ff5,
    0x00ff9, 0x00ff7, 0x00ff6, 0x007f9, 0x00ff4, 0x007f8, 0x003f9, 0x003f7,
    0x003f5, 0x001f8, 0x001f7, 0x000fa, 0x000f8, 0x000f6, 0x00079, 0x0003a,
    0x00038, 0x0001a, 0x0000b, 0x00004, 0x00000, 0x0000a, 0x0000c, 0x0001b,
    0x00039, 0x0003b, 0x00078, 0x0007a, 0x000f7, 0x000f9, 0x001f6, 0x001f9,
    0x003f4, 0x003f6, 0x003f8, 0x007f5, 0x007f4, 0x007f6, 0x007f7, 0x00ff5,
    0x00ff8, 0x01ff4, 0x01ff6, 0x01ff8, 0x03ff8, 0x03ff4, 0x0fff0, 0x07ff4,
    0x0fff6, 0x07ff5, 0x3ffe2, 0x7ffd9, 0x7ffda, 0x7ffdb, 0x7ffdc, 0x7ffdd,
    0x7ffde, 0x7ffd8, 0x7ffd2, 0x7ffd3, 0x7ffd4, 0x7ffd5, 0x7ffd6, 0x7fff2,
    0x7ffdf, 0x7ffe7, 0x7ffe8, 0x7ffe9, 0x7ffea, 0x7ffeb, 0x7ffe6, 0x7ffe0,
    0x7ffe1, 0x7ffe2, 0x7ffe3, 0x7ffe4, 0x7ffe5, 0x7ffd7, 0x7ffec, 0x7fff4,
    0x7fff3,
};
const uint8_t scalefactor_bits[121] = {
    18, 18, 18, 18, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19,
    19, 19, 19, 18, 19, 18, 17, 17, 16, 17, 16, 16, 16, 16, 15, 15,
    14, 14, 14, 14, 14, 14, 13, 13, 12, 12, 12, 11, 12, 11, 10, 10,
    10,  9,  9,  8,  8,  8,  7,  6,  6,  5,  4,  3,  1,  4,  4,  5,
     6,  6,  7,  7,  8,  8,  9,  9, 10, 10, 10, 11, 11, 11, 11, 12,
    12, 13, 13, 13, 14, 14, 16, 15, 16, 15, 18, 19, 19, 19, 19, 19,
    19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19,
    19, 19, 19, 19, 19, 19, 19, 19, 19,
};
static const uint32_t codes1[81] = {
    0x7f8, 0x1f1, 0x7fd, 0x3f5, 0x068, 0x3f0, 0x7f7, 0x1ec,
    0x7f5, 0x3f1, 0x072, 0x3f4, 0x074, 0x011, 0x076, 0x1eb,
    0x06c, 0x3f6, 0x7fc, 0x1e1, 0x7f1, 0x1f0, 0x061, 0x1f6,
    0x7f2, 0x1ea, 0x7fb, 0x1f2, 0x069, 0x1ed, 0x077, 0x017,
    0x06f, 0x1e6, 0x064, 0x1e5, 0x067, 0x015, 0x062, 0x012,
    0x000, 0x014, 0x065, 0x016, 0x06d, 0x1e9, 0x063, 0x1e4,
    0x06b, 0x013, 0x071, 0x1e3, 0x070, 0x1f3, 0x7fe, 0x1e7,
    0x7f3, 0x1ef, 0x060, 0x1ee, 0x7f0, 0x1e2, 0x7fa, 0x3f3,
    0x06a, 0x1e8, 0x075, 0x010, 0x073, 0x1f4, 0x06e, 0x3f7,
    0x7f6, 0x1e0, 0x7f9, 0x3f2, 0x066, 0x1f5, 0x7ff, 0x1f7,
    0x7f4,
};
static const uint8_t bits1[81] = {
    11,  9, 11, 10,  7, 10, 11,  9, 11, 10,  7, 10,  7,  5,  7,  9,
     7, 10, 11,  9, 11,  9,  7,  9, 11,  9, 11,  9,  7,  9,  7,  5,
     7,  9,  7,  9,  7,  5,  7,  5,  1,  5,  7,  5,  7,  9,  7,  9,
     7,  5,  7,  9,  7,  9, 11,  9, 11,  9,  7,  9, 11,  9, 11, 10,
     7,  9,  7,  5,  7,  9,  7, 10, 11,  9, 11, 10,  7,  9, 11,  9,
    11,
};
static const uint32_t codes2[81] = {
    0x1f3, 0x06f, 0x1fd, 0x0eb, 0x023, 0x0ea, 0x1f7, 0x0e8,
    0x1fa, 0x0f2, 0x02d, 0x070, 0x020, 0x006, 0x02b, 0x06e,
    0x028, 0x0e9, 0x1f9, 0x066, 0x0f8, 0x0e7, 0x01b, 0x0f1,
    0x1f4, 0x06b, 0x1f5, 0x0ec, 0x02a, 0x06c, 0x02c, 0x00a,
    0x027, 0x067, 0x01a, 0x0f5, 0x024, 0x008, 0x01f, 0x009,
    0x000, 0x007, 0x01d, 0x00b, 0x030, 0x0ef, 0x01c, 0x064,
    0x01e, 0x00c, 0x029, 0x0f3, 0x02f, 0x0f0, 0x1fc, 0x071,
    0x1f2, 0x0f4, 0x021, 0x0e6, 0x0f7, 0x068, 0x1f8, 0x0ee,
    0x022, 0x065, 0x031, 0x002, 0x026, 0x0ed, 0x025, 0x06a,
    0x1fb, 0x072, 0x1fe, 0x069, 0x02e, 0x0f6, 0x1ff, 0x06d,
    0x1f6,
};
static const uint8_t bits2[81] = {
    9, 7, 9, 8, 6, 8, 9, 8, 9, 8, 6, 7, 6, 5, 6, 7,
    6, 8, 9, 7, 8, 8, 6, 8, 9, 7, 9, 8, 6, 7, 6, 5,
    6, 7, 6, 8, 6, 5, 6, 5, 3, 5, 6, 5, 6, 8, 6, 7,
    6, 5, 6, 8, 6, 8, 9, 7, 9, 8, 6, 8, 8, 7, 9, 8,
    6, 7, 6, 4, 6, 8, 6, 7, 9, 7, 9, 7, 6, 8, 9, 7,
    9,
};
static const uint32_t codes3[81] = {
    0x0000, 0x0009, 0x00ef, 0x000b, 0x0019, 0x00f0, 0x01eb, 0x01e6,
    0x03f2, 0x000a, 0x0035, 0x01ef, 0x0034, 0x0037, 0x01e9, 0x01ed,
    0x01e7, 0x03f3, 0x01ee, 0x03ed, 0x1ffa, 0x01ec, 0x01f2, 0x07f9,
    0x07f8, 0x03f8, 0x0ff8, 0x0008, 0x0038, 0x03f6, 0x0036, 0x0075,
    0x03f1, 0x03eb, 0x03ec, 0x0ff4, 0x0018, 0x0076, 0x07f4, 0x0039,
    0x0074, 0x03ef, 0x01f3, 0x01f4, 0x07f6, 0x01e8, 0x03ea, 0x1ffc,
    0x00f2, 0x01f1, 0x0ffb, 0x03f5, 0x07f3, 0x0ffc, 0x00ee, 0x03f7,
    0x7ffe, 0x01f0, 0x07f5, 0x7ffd, 0x1ffb, 0x3ffa, 0xffff, 0x00f1,
    0x03f0, 0x3ffc, 0x01ea, 0x03ee, 0x3ffb, 0x0ff6, 0x0ffa, 0x7ffc,
    0x07f2, 0x0ff5, 0xfffe, 0x03f4, 0x07f7, 0x7ffb, 0x0ff7, 0x0ff9,
    0x7ffa,
};
static const uint8_t bits3[81] = {
     1,  4,  8,  4,  5,  8,  9,  9, 10,  4,  6,  9,  6,  6,  9,  9,
     9, 10,  9, 10, 13,  9,  9, 11, 11, 10, 12,  4,  6, 10,  6,  7,
    10, 10, 10, 12,  5,  7, 11,  6,  7, 10,  9,  9, 11,  9, 10, 13,
     8,  9, 12, 10, 11, 12,  8, 10, 15,  9, 11, 15, 13, 14, 16,  8,
    10, 14,  9, 10, 14, 12, 12, 15, 11, 12, 16, 10, 11, 15, 12, 12,
    15,
};
static const uint32_t codes4[81] = {
    0x007, 0x016, 0x0f6, 0x018, 0x008, 0x0ef, 0x1ef, 0x0f3,
    0x7f8, 0x019, 0x017, 0x0ed, 0x015, 0x001, 0x0e2, 0x0f0,
    0x070, 0x3f0, 0x1ee, 0x0f1, 0x7fa, 0x0ee, 0x0e4, 0x3f2,
    0x7f6, 0x3ef, 0x7fd, 0x005, 0x014, 0x0f2, 0x009, 0x004,
    0x0e5, 0x0f4, 0x0e8, 0x3f4, 0x006, 0x002, 0x0e7, 0x003,
    0x000, 0x06b, 0x0e3, 0x069, 0x1f3, 0x0eb, 0x0e6, 0x3f6,
    0x06e, 0x06a, 0x1f4, 0x3ec, 0x1f0, 0x3f9, 0x0f5, 0x0ec,
    0x7fb, 0x0ea, 0x06f, 0x3f7, 0x7f9, 0x3f3, 0xfff, 0x0e9,
    0x06d, 0x3f8, 0x06c, 0x068, 0x1f5, 0x3ee, 0x1f2, 0x7f4,
    0x7f7, 0x3f1, 0xffe, 0x3ed, 0x1f1, 0x7f5, 0x7fe, 0x3f5,
    0x7fc,
};
static const uint8_t bits4[81] = {
     4,  5,  8,  5,  4,  8,  9,  8, 11,  5,  5,  8,  5,  4,  8,  8,
     7, 10,  9,  8, 11,  8,  8, 10, 11, 10, 11,  4,  5,  8,  4,  4,
     8,  8,  8, 10,  4,  4,  8,  4,  4,  7,  8,  7,  9,  8,  8, 10,
     7,  7,  9, 10,  9, 10,  8,  8, 11,  8,  7, 10, 11, 10, 12,  8,
     7, 10,  7,  7,  9, 10,  9, 11, 11, 10, 12, 10,  9, 11, 11, 10,
    11,
};
static const uint32_t codes5[81] = {
    0x1fff, 0x0ff7, 0x07f4, 0x07e8, 0x03f1, 0x07ee, 0x07f9, 0x0ff8,
    0x1ffd, 0x0ffd, 0x07f1, 0x03e8, 0x01e8, 0x00f0, 0x01ec, 0x03ee,
    0x07f2, 0x0ffa, 0x0ff4, 0x03ef, 0x01f2, 0x00e8, 0x0070, 0x00ec,
    0x01f0, 0x03ea, 0x07f3, 0x07eb, 0x01eb, 0x00ea, 0x001a, 0x0008,
    0x0019, 0x00ee, 0x01ef, 0x07ed, 0x03f0, 0x00f2, 0x0073, 0x000b,
    0x0000, 0x000a, 0x0071, 0x00f3, 0x07e9, 0x07ef, 0x01ee, 0x00ef,
    0x0018, 0x0009, 0x001b, 0x00eb, 0x01e9, 0x07ec, 0x07f6, 0x03eb,
    0x01f3, 0x00ed, 0x0072, 0x00e9, 0x01f1, 0x03ed, 0x07f7, 0x0ff6,
    0x07f0, 0x03e9, 0x01ed, 0x00f1, 0x01ea, 0x03ec, 0x07f8, 0x0ff9,
    0x1ffc, 0x0ffc, 0x0ff5, 0x07ea, 0x03f3, 0x03f2, 0x07f5, 0x0ffb,
    0x1ffe,
};
static const uint8_t bits5[81] = {
    13, 12, 11, 11, 10, 11, 11, 12, 13, 12, 11, 10,  9,  8,  9, 10,
    11, 12, 12, 10,  9,  8,  7,  8,  9, 10, 11, 11,  9,  8,  5,  4,
     5,  8,  9, 11, 10,  8,  7,  4,  1,  4,  7,  8, 11, 11,  9,  8,
     5,  4,  5,  8,  9, 11, 11, 10,  9,  8,  7,  8,  9, 10, 11, 12,
    11, 10,  9,  8,  9, 10, 11, 12, 13, 12, 12, 11, 10, 10, 11, 12,
    13,
};
static const uint32_t codes6[81] = {
    0x7fe, 0x3fd, 0x1f1, 0x1eb, 0x1f4, 0x1ea, 0x1f0, 0x3fc,
    0x7fd, 0x3f6, 0x1e5, 0x0ea, 0x06c, 0x071, 0x068, 0x0f0,
    0x1e6, 0x3f7, 0x1f3, 0x0ef, 0x032, 0x027, 0x028, 0x026,
    0x031, 0x0eb, 0x1f7, 0x1e8, 0x06f, 0x02e, 0x008, 0x004,
    0x006, 0x029, 0x06b, 0x1ee, 0x1ef, 0x072, 0x02d, 0x002,
    0x000, 0x003, 0x02f, 0x073, 0x1fa, 0x1e7, 0x06e, 0x02b,
    0x007, 0x001, 0x005, 0x02c, 0x06d, 0x1ec, 0x1f9, 0x0ee,
    0x030, 0x024, 0x02a, 0x025, 0x033, 0x0ec, 0x1f2, 0x3f8,
    0x1e4, 0x0ed, 0x06a, 0x070, 0x069, 0x074, 0x0f1, 0x3fa,
    0x7ff, 0x3f9, 0x1f6, 0x1ed, 0x1f8, 0x1e9, 0x1f5, 0x3fb,
    0x7fc,
};
static const uint8_t bits6[81] = {
    11, 10,  9,  9,  9,  9,  9, 10, 11, 10,  9,  8,  7,  7,  7,  8,
     9, 10,  9,  8,  6,  6,  6,  6,  6,  8,  9,  9,  7,  6,  4,  4,
     4,  6,  7,  9,  9,  7,  6,  4,  4,  4,  6,  7,  9,  9,  7,  6,
     4,  4,  4,  6,  7,  9,  9,  8,  6,  6,  6,  6,  6,  8,  9, 10,
     9,  8,  7,  7,  7,  7,  8, 10, 11, 10,  9,  9,  9,  9,  9, 10,
    11,
};
static const uint32_t codes7[64] = {
    0x000, 0x005, 0x037, 0x074, 0x0f2, 0x1eb, 0x3ed, 0x7f7,
    0x004, 0x00c, 0x035, 0x071, 0x0ec, 0x0ee, 0x1ee, 0x1f5,
    0x036, 0x034, 0x072, 0x0ea, 0x0f1, 0x1e9, 0x1f3, 0x3f5,
    0x073, 0x070, 0x0eb, 0x0f0, 0x1f1, 0x1f0, 0x3ec, 0x3fa,
    0x0f3, 0x0ed, 0x1e8, 0x1ef, 0x3ef, 0x3f1, 0x3f9, 0x7fb,
    0x1ed, 0x0ef, 0x1ea, 0x1f2, 0x3f3, 0x3f8, 0x7f9, 0x7fc,
    0x3ee, 0x1ec, 0x1f4, 0x3f4, 0x3f7, 0x7f8, 0xffd, 0xffe,
    0x7f6, 0x3f0, 0x3f2, 0x3f6, 0x7fa, 0x7fd, 0xffc, 0xfff,
};
static const uint8_t bits7[64] = {
     1,  3,  6,  7,  8,  9, 10, 11,  3,  4,  6,  7,  8,  8,  9,  9,
     6,  6,  7,  8,  8,  9,  9, 10,  7,  7,  8,  8,  9,  9, 10, 10,
     8,  8,  9,  9, 10, 10, 10, 11,  9,  8,  9,  9, 10, 10, 11, 11,
    10,  9,  9, 10, 10, 11, 12, 12, 11, 10, 10, 10, 11, 11, 12, 12,
};
static const uint32_t codes8[64] = {
    0x00e, 0x005, 0x010, 0x030, 0x06f, 0x0f1, 0x1fa, 0x3fe,
    0x003, 0x000, 0x004, 0x012, 0x02c, 0x06a, 0x075, 0x0f8,
    0x00f, 0x002, 0x006, 0x014, 0x02e, 0x069, 0x072, 0x0f5,
    0x02f, 0x011, 0x013, 0x02a, 0x032, 0x06c, 0x0ec, 0x0fa,
    0x071, 0x02b, 0x02d, 0x031, 0x06d, 0x070, 0x0f2, 0x1f9,
    0x0ef, 0x068, 0x033, 0x06b, 0x06e, 0x0ee, 0x0f9, 0x3fc,
    0x1f8, 0x074, 0x073, 0x0ed, 0x0f0, 0x0f6, 0x1f6, 0x1fd,
    0x3fd, 0x0f3, 0x0f4, 0x0f7, 0x1f7, 0x1fb, 0x1fc, 0x3ff,
};
static const uint8_t bits8[64] = {
     5,  4,  5,  6,  7,  8,  9, 10,  4,  3,  4,  5,  6,  7,  7,  8,
     5,  4,  4,  5,  6,  7,  7,  8,  6,  5,  5,  6,  6,  7,  8,  8,
     7,  6,  6,  6,  7,  7,  8,  9,  8,  7,  6,  7,  7,  8,  8, 10,
     9,  7,  7,  8,  8,  8,  9,  9, 10,  8,  8,  8,  9,  9,  9, 10,
};
static const uint32_t codes9[169] = {
    0x0000, 0x0005, 0x0037, 0x00e7, 0x01de, 0x03ce, 0x03d9, 0x07c8,
    0x07cd, 0x0fc8, 0x0fdd, 0x1fe4, 0x1fec, 0x0004, 0x000c, 0x0035,
    0x0072, 0x00ea, 0x00ed, 0x01e2, 0x03d1, 0x03d3, 0x03e0, 0x07d8,
    0x0fcf, 0x0fd5, 0x0036, 0x0034, 0x0071, 0x00e8, 0x00ec, 0x01e1,
    0x03cf, 0x03dd, 0x03db, 0x07d0, 0x0fc7, 0x0fd4, 0x0fe4, 0x00e6,
    0x0070, 0x00e9, 0x01dd, 0x01e3, 0x03d2, 0x03dc, 0x07cc, 0x07ca,
    0x07de, 0x0fd8, 0x0fea, 0x1fdb, 0x01df, 0x00eb, 0x01dc, 0x01e6,
    0x03d5, 0x03de, 0x07cb, 0x07dd, 0x07dc, 0x0fcd, 0x0fe2, 0x0fe7,
    0x1fe1, 0x03d0, 0x01e0, 0x01e4, 0x03d6, 0x07c5, 0x07d1, 0x07db,
    0x0fd2, 0x07e0, 0x0fd9, 0x0feb, 0x1fe3, 0x1fe9, 0x07c4, 0x01e5,
    0x03d7, 0x07c6, 0x07cf, 0x07da, 0x0fcb, 0x0fda, 0x0fe3, 0x0fe9,
    0x1fe6, 0x1ff3, 0x1ff7, 0x07d3, 0x03d8, 0x03e1, 0x07d4, 0x07d9,
    0x0fd3, 0x0fde, 0x1fdd, 0x1fd9, 0x1fe2, 0x1fea, 0x1ff1, 0x1ff6,
    0x07d2, 0x03d4, 0x03da, 0x07c7, 0x07d7, 0x07e2, 0x0fce, 0x0fdb,
    0x1fd8, 0x1fee, 0x3ff0, 0x1ff4, 0x3ff2, 0x07e1, 0x03df, 0x07c9,
    0x07d6, 0x0fca, 0x0fd0, 0x0fe5, 0x0fe6, 0x1feb, 0x1fef, 0x3ff3,
    0x3ff4, 0x3ff5, 0x0fe0, 0x07ce, 0x07d5, 0x0fc6, 0x0fd1, 0x0fe1,
    0x1fe0, 0x1fe8, 0x1ff0, 0x3ff1, 0x3ff8, 0x3ff6, 0x7ffc, 0x0fe8,
    0x07df, 0x0fc9, 0x0fd7, 0x0fdc, 0x1fdc, 0x1fdf, 0x1fed, 0x1ff5,
    0x3ff9, 0x3ffb, 0x7ffd, 0x7ffe, 0x1fe7, 0x0fcc, 0x0fd6, 0x0fdf,
    0x1fde, 0x1fda, 0x1fe5, 0x1ff2, 0x3ffa, 0x3ff7, 0x3ffc, 0x3ffd,
    0x7fff,
};
static const uint8_t bits9[169] = {
     1,  3,  6,  8,  9, 10, 10, 11, 11, 12, 12, 13, 13,  3,  4,  6,
     7,  8,  8,  9, 10, 10, 10, 11, 12, 12,  6,  6,  7,  8,  8,  9,
    10, 10, 10, 11, 12, 12, 12,  8,  7,  8,  9,  9, 10, 10, 11, 11,
    11, 12, 12, 13,  9,  8,  9,  9, 10, 10, 11, 11, 11, 12, 12, 12,
    13, 10,  9,  9, 10, 11, 11, 11, 12, 11, 12, 12, 13, 13, 11,  9,
    10, 11, 11, 11, 12, 12, 12, 12, 13, 13, 13, 11, 10, 10, 11, 11,
    12, 12, 13, 13, 13, 13, 13, 13, 11, 10, 10, 11, 11, 11, 12, 12,
    13, 13, 14, 13, 14, 11, 10, 11, 11, 12, 12, 12, 12, 13, 13, 14,
    14, 14, 12, 11, 11, 12, 12, 12, 13, 13, 13, 14, 14, 14, 15, 12,
    11, 12, 12, 12, 13, 13, 13, 13, 14, 14, 15, 15, 13, 12, 12, 12,
    13, 13, 13, 13, 14, 14, 14, 14, 15,
};
static const uint32_t codes10[169] = {
    0x022, 0x008, 0x01d, 0x026, 0x05f, 0x0d3, 0x1cf, 0x3d0,
    0x3d7, 0x3ed, 0x7f0, 0x7f6, 0xffd, 0x007, 0x000, 0x001,
    0x009, 0x020, 0x054, 0x060, 0x0d5, 0x0dc, 0x1d4, 0x3cd,
    0x3de, 0x7e7, 0x01c, 0x002, 0x006, 0x00c, 0x01e, 0x028,
    0x05b, 0x0cd, 0x0d9, 0x1ce, 0x1dc, 0x3d9, 0x3f1, 0x025,
    0x00b, 0x00a, 0x00d, 0x024, 0x057, 0x061, 0x0cc, 0x0dd,
    0x1cc, 0x1de, 0x3d3, 0x3e7, 0x05d, 0x021, 0x01f, 0x023,
    0x027, 0x059, 0x064, 0x0d8, 0x0df, 0x1d2, 0x1e2, 0x3dd,
    0x3ee, 0x0d1, 0x055, 0x029, 0x056, 0x058, 0x062, 0x0ce,
    0x0e0, 0x0e2, 0x1da, 0x3d4, 0x3e3, 0x7eb, 0x1c9, 0x05e,
    0x05a, 0x05c, 0x063, 0x0ca, 0x0da, 0x1c7, 0x1ca, 0x1e0,
    0x3db, 0x3e8, 0x7ec, 0x1e3, 0x0d2, 0x0cb, 0x0d0, 0x0d7,
    0x0db, 0x1c6, 0x1d5, 0x1d8, 0x3ca, 0x3da, 0x7ea, 0x7f1,
    0x1e1, 0x0d4, 0x0cf, 0x0d6, 0x0de, 0x0e1, 0x1d0, 0x1d6,
    0x3d1, 0x3d5, 0x3f2, 0x7ee, 0x7fb, 0x3e9, 0x1cd, 0x1c8,
    0x1cb, 0x1d1, 0x1d7, 0x1df, 0x3cf, 0x3e0, 0x3ef, 0x7e6,
    0x7f8, 0xffa, 0x3eb, 0x1dd, 0x1d3, 0x1d9, 0x1db, 0x3d2,
    0x3cc, 0x3dc, 0x3ea, 0x7ed, 0x7f3, 0x7f9, 0xff9, 0x7f2,
    0x3ce, 0x1e4, 0x3cb, 0x3d8, 0x3d6, 0x3e2, 0x3e5, 0x7e8,
    0x7f4, 0x7f5, 0x7f7, 0xffb, 0x7fa, 0x3ec, 0x3df, 0x3e1,
    0x3e4, 0x3e6, 0x3f0, 0x7e9, 0x7ef, 0xff8, 0xffe, 0xffc,
    0xfff,
};
static const uint8_t bits10[169] = {
     6,  5,  6,  6,  7,  8,  9, 10, 10, 10, 11, 11, 12,  5,  4,  4,
     5,  6,  7,  7,  8,  8,  9, 10, 10, 11,  6,  4,  5,  5,  6,  6,
     7,  8,  8,  9,  9, 10, 10,  6,  5,  5,  5,  6,  7,  7,  8,  8,
     9,  9, 10, 10,  7,  6,  6,  6,  6,  7,  7,  8,  8,  9,  9, 10,
    10,  8,  7,  6,  7,  7,  7,  8,  8,  8,  9, 10, 10, 11,  9,  7,
     7,  7,  7,  8,  8,  9,  9,  9, 10, 10, 11,  9,  8,  8,  8,  8,
     8,  9,  9,  9, 10, 10, 11, 11,  9,  8,  8,  8,  8,  8,  9,  9,
    10, 10, 10, 11, 11, 10,  9,  9,  9,  9,  9,  9, 10, 10, 10, 11,
    11, 12, 10,  9,  9,  9,  9, 10, 10, 10, 10, 11, 11, 11, 12, 11,
    10,  9, 10, 10, 10, 10, 10, 11, 11, 11, 11, 12, 11, 10, 10, 10,
    10, 10, 10, 11, 11, 12, 12, 12, 12,
};
static const uint32_t codes11[289] = {
    0x000, 0x006, 0x019, 0x03d, 0x09c, 0x0c6, 0x1a7, 0x390,
    0x3c2, 0x3df, 0x7e6, 0x7f3, 0xffb, 0x7ec, 0xffa, 0xffe,
    0x38e, 0x005, 0x001, 0x008, 0x014, 0x037, 0x042, 0x092,
    0x0af, 0x191, 0x1a5, 0x1b5, 0x39e, 0x3c0, 0x3a2, 0x3cd,
    0x7d6, 0x0ae, 0x017, 0x007, 0x009, 0x018, 0x039, 0x040,
    0x08e, 0x0a3, 0x0b8, 0x199, 0x1ac, 0x1c1, 0x3b1, 0x396,
    0x3be, 0x3ca, 0x09d, 0x03c, 0x015, 0x016, 0x01a, 0x03b,
    0x044, 0x091, 0x0a5, 0x0be, 0x196, 0x1ae, 0x1b9, 0x3a1,
    0x391, 0x3a5, 0x3d5, 0x094, 0x09a, 0x036, 0x038, 0x03a,
    0x041, 0x08c, 0x09b, 0x0b0, 0x0c3, 0x19e, 0x1ab, 0x1bc,
    0x39f, 0x38f, 0x3a9, 0x3cf, 0x093, 0x0bf, 0x03e, 0x03f,
    0x043, 0x045, 0x09e, 0x0a7, 0x0b9, 0x194, 0x1a2, 0x1ba,
    0x1c3, 0x3a6, 0x3a7, 0x3bb, 0x3d4, 0x09f, 0x1a0, 0x08f,
    0x08d, 0x090, 0x098, 0x0a6, 0x0b6, 0x0c4, 0x19f, 0x1af,
    0x1bf, 0x399, 0x3bf, 0x3b4, 0x3c9, 0x3e7, 0x0a8, 0x1b6,
    0x0ab, 0x0a4, 0x0aa, 0x0b2, 0x0c2, 0x0c5, 0x198, 0x1a4,
    0x1b8, 0x38c, 0x3a4, 0x3c4, 0x3c6, 0x3dd, 0x3e8, 0x0ad,
    0x3af, 0x192, 0x0bd, 0x0bc, 0x18e, 0x197, 0x19a, 0x1a3,
    0x1b1, 0x38d, 0x398, 0x3b7, 0x3d3, 0x3d1, 0x3db, 0x7dd,
    0x0b4, 0x3de, 0x1a9, 0x19b, 0x19c, 0x1a1, 0x1aa, 0x1ad,
    0x1b3, 0x38b, 0x3b2, 0x3b8, 0x3ce, 0x3e1, 0x3e0, 0x7d2,
    0x7e5, 0x0b7, 0x7e3, 0x1bb, 0x1a8, 0x1a6, 0x1b0, 0x1b2,
    0x1b7, 0x39b, 0x39a, 0x3ba, 0x3b5, 0x3d6, 0x7d7, 0x3e4,
    0x7d8, 0x7ea, 0x0ba, 0x7e8, 0x3a0, 0x1bd, 0x1b4, 0x38a,
    0x1c4, 0x392, 0x3aa, 0x3b0, 0x3bc, 0x3d7, 0x7d4, 0x7dc,
    0x7db, 0x7d5, 0x7f0, 0x0c1, 0x7fb, 0x3c8, 0x3a3, 0x395,
    0x39d, 0x3ac, 0x3ae, 0x3c5, 0x3d8, 0x3e2, 0x3e6, 0x7e4,
    0x7e7, 0x7e0, 0x7e9, 0x7f7, 0x190, 0x7f2, 0x393, 0x1be,
    0x1c0, 0x394, 0x397, 0x3ad, 0x3c3, 0x3c1, 0x3d2, 0x7da,
    0x7d9, 0x7df, 0x7eb, 0x7f4, 0x7fa, 0x195, 0x7f8, 0x3bd,
    0x39c, 0x3ab, 0x3a8, 0x3b3, 0x3b9, 0x3d0, 0x3e3, 0x3e5,
    0x7e2, 0x7de, 0x7ed, 0x7f1, 0x7f9, 0x7fc, 0x193, 0xffd,
    0x3dc, 0x3b6, 0x3c7, 0x3cc, 0x3cb, 0x3d9, 0x3da, 0x7d3,
    0x7e1, 0x7ee, 0x7ef, 0x7f5, 0x7f6, 0xffc, 0xfff, 0x19d,
    0x1c2, 0x0b5, 0x0a1, 0x096, 0x097, 0x095, 0x099, 0x0a0,
    0x0a2, 0x0ac, 0x0a9, 0x0b1, 0x0b3, 0x0bb, 0x0c0, 0x18f,
    0x004,
};
static const uint8_t bits11[289] = {
     4,  5,  6,  7,  8,  8,  9, 10, 10, 10, 11, 11, 12, 11, 12, 12,
    10,  5,  4,  5,  6,  7,  7,  8,  8,  9,  9,  9, 10, 10, 10, 10,
    11,  8,  6,  5,  5,  6,  7,  7,  8,  8,  8,  9,  9,  9, 10, 10,
    10, 10,  8,  7,  6,  6,  6,  7,  7,  8,  8,  8,  9,  9,  9, 10,
    10, 10, 10,  8,  8,  7,  7,  7,  7,  8,  8,  8,  8,  9,  9,  9,
    10, 10, 10, 10,  8,  8,  7,  7,  7,  7,  8,  8,  8,  9,  9,  9,
     9, 10, 10, 10, 10,  8,  9,  8,  8,  8,  8,  8,  8,  8,  9,  9,
     9, 10, 10, 10, 10, 10,  8,  9,  8,  8,  8,  8,  8,  8,  9,  9,
     9, 10, 10, 10, 10, 10, 10,  8, 10,  9,  8,  8,  9,  9,  9,  9,
     9, 10, 10, 10, 10, 10, 10, 11,  8, 10,  9,  9,  9,  9,  9,  9,
     9, 10, 10, 10, 10, 10, 10, 11, 11,  8, 11,  9,  9,  9,  9,  9,
     9, 10, 10, 10, 10, 10, 11, 10, 11, 11,  8, 11, 10,  9,  9, 10,
     9, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11,  8, 11, 10, 10, 10,
    10, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11,  9, 11, 10,  9,
     9, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11, 11,  9, 11, 10,
    10, 10, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11, 11,  9, 12,
    10, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11, 11, 12, 12,  9,
     9,  8,  8,  8,  8,  8,  8,  8,  8,  8,  8,  8,  8,  8,  8,  9,
     5,
};

static const HuffmanTable scalefactor_table = { scalefactor_codes, scalefactor_bits, 121 };
static const HuffmanTable spectral_tables[11] = {
  { codes1, bits1, 81 }, { codes2, bits2, 81 }, { codes3, bits3, 81 },
  { codes4, bits4, 81 }, { codes5, bits5, 81 }, { codes6, bits6, 81 },
  { codes7, bits7, 64 }, { codes8, bits8, 64 }, { codes9, bits9, 169 },
  { codes10, bits10, 169 }, { codes11, bits11, 289 },
};

static float spectrum[VOLTA_AAC_MAX_CHANNELS][VOLTA_AAC_FRAME_SAMPLES];
static float overlap[VOLTA_AAC_MAX_CHANNELS][VOLTA_AAC_FRAME_SAMPLES];
static float decoded[VOLTA_AAC_MAX_CHANNELS][VOLTA_AAC_FRAME_SAMPLES];
static uint8_t ms_used[VOLTA_AAC_MAX_SFB];
static uint32_t last_sample_rate;
static uint32_t last_channels;

static const uint32_t sample_rates[13] = {
  96000, 88200, 64000, 48000, 44100, 32000, 24000,
  22050, 16000, 12000, 11025, 8000, 7350,
};

/* Long-window scalefactor-band boundaries for the rates most used by music. */
static const uint16_t bands_44100[] = {
  0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80,
  88, 96, 108, 120, 132, 144, 160, 176, 196, 216, 240, 264, 292, 320,
  352, 384, 416, 448, 480, 512, 544, 576, 608, 640, 672, 704, 736,
  768, 800, 832, 864, 896, 928, 1024,
};

static const uint16_t bands_48000[] = {
  0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80,
  88, 96, 108, 120, 132, 144, 160, 176, 196, 216, 240, 264, 292, 320,
  352, 384, 416, 448, 480, 512, 544, 576, 608, 640, 672, 704, 736,
  768, 800, 832, 864, 896, 928, 1024,
};

static uint32_t br_left(const BitReader *reader) {
  uint32_t total = reader->length * 8u;
  return reader->position < total ? total - reader->position : 0u;
}

static uint32_t br_read(BitReader *reader, uint32_t bits) {
  uint32_t value = 0;
  uint32_t index;
  if (bits > 32u || br_left(reader) < bits) {
    reader->error = AAC_INVALID;
    return 0;
  }
  for (index = 0; index < bits; index++) {
    uint32_t byte_index = reader->position >> 3u;
    uint32_t bit_index = 7u - (reader->position & 7u);
    value = (value << 1u) | ((reader->data[byte_index] >> bit_index) & 1u);
    reader->position++;
  }
  return value;
}

static void br_skip(BitReader *reader, uint32_t bits) {
  if (br_left(reader) < bits) reader->error = AAC_INVALID;
  else reader->position += bits;
}

static int32_t read_huffman(BitReader *reader, const HuffmanTable *table) {
  uint32_t code = 0;
  uint32_t length;
  uint32_t index;
  for (length = 1; length <= 20u; length++) {
    code = (code << 1u) | br_read(reader, 1u);
    if (reader->error) return reader->error;
    for (index = 0; index < table->size; index++)
      if (table->bits[index] == length && table->codes[index] == code)
        return (int32_t)index;
  }
  reader->error = AAC_INVALID;
  return AAC_INVALID;
}

static double vcos(double value) {
  const double pi = 3.14159265358979323846;
  const double two_pi = 6.28318530717958647692;
  double squared;
  int32_t turns = (int32_t)(value / two_pi);
  value -= (double)turns * two_pi;
  while (value > pi) value -= two_pi;
  while (value < -pi) value += two_pi;
  if (value > pi * 0.5) return -vcos(value - pi);
  if (value < -pi * 0.5) return -vcos(value + pi);
  squared = value * value;
  return 1.0 + squared * (-0.5 + squared * (0.0416666666666667 +
    squared * (-0.00138888888888889 + squared * (0.0000248015873015873 +
    squared * (-0.000000275573192239859)))));
}

static float scale_value(int32_t scale) {
  /* 2^(scale/4), using the exact quarter-step values and binary exponent. */
  static const double quarter[4] = { 1.0, 1.189207115002721, 1.414213562373095,
    1.681792830507429 };
  int32_t exponent = scale / 4;
  int32_t remainder = scale % 4;
  double value;
  if (remainder < 0) { remainder += 4; exponent--; }
  value = quarter[(uint32_t)remainder];
  if (exponent > 0) while (exponent-- > 0) value *= 2.0;
  if (exponent < 0) while (exponent++ < 0) value *= 0.5;
  return (float)value;
}

static float magnitude_value(uint32_t magnitude) {
  static const float table[] = {
    0.0f, 1.0f, 2.5198420998f, 4.3267487109f, 6.3496042079f,
    8.5498797334f, 10.9027235560f, 13.3905182794f, 16.0f,
    18.7207544075f, 21.5443469003f, 24.4662666922f, 27.4820151510f,
    30.5873539391f, 33.7797638560f, 37.0564985168f, 40.3174735966f,
  };
  if (magnitude < sizeof(table) / sizeof(table[0])) return table[magnitude];
  return magnitude_value(magnitude >> 1u) * 2.5198420998f;
}

static int32_t parse_adts(const uint8_t *data, uint32_t length, AdtsFrame *frame) {
  uint32_t protection_absent;
  uint32_t profile;
  uint32_t sample_index;
  uint32_t channel_config;
  uint32_t frame_length;
  if (!data || length < 7u || data[0] != 0xffu || (data[1] & 0xf6u) != 0xf0u)
    return AAC_INVALID;
  protection_absent = data[1] & 1u;
  profile = (data[2] >> 6u) & 3u;
  sample_index = (data[2] >> 2u) & 15u;
  channel_config = ((uint32_t)(data[2] & 1u) << 2u) | (data[3] >> 6u);
  frame_length = ((uint32_t)(data[3] & 3u) << 11u) |
    ((uint32_t)data[4] << 3u) | (data[5] >> 5u);
  if (profile != 1u || (sample_index != 3u && sample_index != 4u) || !channel_config || channel_config > 2u ||
      (data[6] & 3u) || frame_length < (protection_absent ? 7u : 9u) || frame_length > length)
    return AAC_UNSUPPORTED;
  frame->sample_rate = sample_rates[sample_index];
  frame->channels = channel_config;
  frame->payload_offset = protection_absent ? 7u : 9u;
  frame->payload_length = frame_length - frame->payload_offset;
  return AAC_OK;
}

static uint32_t band_count(uint32_t sample_rate, const uint16_t **bands) {
  if (sample_rate == 48000u) {
    *bands = bands_48000;
    return (uint32_t)(sizeof(bands_48000) / sizeof(bands_48000[0])) - 1u;
  }
  *bands = bands_44100;
  return (uint32_t)(sizeof(bands_44100) / sizeof(bands_44100[0])) - 1u;
}

static int32_t read_ics_info(BitReader *reader, IcsInfo *info, uint32_t sample_rate) {
  const uint16_t *bands;
  uint32_t count;
  uint32_t index;
  uint32_t reserved = br_read(reader, 1u);
  uint32_t window_sequence = br_read(reader, 2u);
  uint32_t window_shape = br_read(reader, 1u);
  (void)window_shape;
  (void)sample_rate;
  /* Long-start/long-stop are still represented by one 1024-line spectrum.
     They use a less ideal transition window below; eight-short is rejected. */
  if (reserved || window_sequence == 2u) return AAC_UNSUPPORTED;
  info->max_sfb = br_read(reader, 6u);
  if (br_read(reader, 1u)) return AAC_UNSUPPORTED; /* predictor_data_present */
  if (reader->error || info->max_sfb > VOLTA_AAC_MAX_SFB) return AAC_INVALID;
  count = band_count(sample_rate, &bands);
  if (info->max_sfb > count) return AAC_INVALID;
  for (index = 0; index < info->max_sfb; index++) info->codebook[index] = 0;
  return reader->error ? reader->error : AAC_OK;
}

static int32_t read_sections(BitReader *reader, IcsInfo *info) {
  uint32_t sfb = 0;
  while (sfb < info->max_sfb) {
    uint32_t codebook = br_read(reader, 4u);
    uint32_t section_length = 0;
    uint32_t increment;
    if (reader->error || codebook == 12u || codebook > 15u) return AAC_UNSUPPORTED;
    do {
      increment = br_read(reader, 5u); /* long-window sect_len_incr */
      section_length += increment;
    } while (!reader->error && increment == 31u && section_length < 64u);
    if (reader->error || !section_length || sfb + section_length > info->max_sfb)
      return AAC_INVALID;
    while (section_length--) info->codebook[sfb++] = (uint8_t)codebook;
  }
  return AAC_OK;
}

static int32_t read_scale_factors(BitReader *reader, IcsInfo *info, uint32_t global_gain) {
  int32_t scale = (int32_t)global_gain;
  uint32_t noise_seen = 0;
  uint32_t sfb;
  for (sfb = 0; sfb < info->max_sfb; sfb++) {
    int32_t delta;
    if (!info->codebook[sfb]) {
      info->scale[sfb] = (int16_t)scale;
      continue;
    }
    if (info->codebook[sfb] == 13u && !noise_seen++) {
      if (br_read(reader, 1u)) {
        scale = (int32_t)br_read(reader, 9u);
        if (reader->error) return reader->error;
        info->scale[sfb] = (int16_t)scale;
      continue;
      }
    }
    delta = read_huffman(reader, &scalefactor_table);
    if (delta < 0) return delta;
    scale += delta - 60;
    if (scale < 0 || scale > 255) return AAC_INVALID;
    info->scale[sfb] = (int16_t)scale;
  }
  return AAC_OK;
}

static uint32_t read_escape(BitReader *reader) {
  uint32_t prefix = 0;
  uint32_t bit;
  while (prefix < 16u && !reader->error) {
    bit = br_read(reader, 1u);
    if (!bit) break;
    prefix++;
  }
  if (reader->error || prefix >= 16u) { reader->error = AAC_INVALID; return 0; }
  return (1u << (prefix + 4u)) | br_read(reader, prefix + 4u);
}

static int32_t read_spectral_value(BitReader *reader, uint32_t codebook, float *destination) {
  const HuffmanTable *table = &spectral_tables[codebook - 1u];
  uint32_t symbol = (uint32_t)read_huffman(reader, table);
  uint32_t dimension;
  uint32_t base;
  uint32_t index;
  if (reader->error) return reader->error;
  dimension = codebook < 5u ? 4u : 2u;
  base = codebook < 5u ? 3u : codebook < 7u ? 9u : codebook < 9u ? 8u : codebook < 11u ? 13u : 17u;
  for (index = 0; index < dimension; index++) {
    uint32_t divisor = 1;
    uint32_t digit;
    uint32_t power = dimension - index - 1u;
    while (power--) divisor *= base;
    digit = (symbol / divisor) % base;
    if (codebook == 1u || codebook == 2u) destination[index] = (float)((int32_t)digit - 1);
    else if (codebook == 5u) destination[index] = (float)((int32_t)digit - 4);
    else {
      destination[index] = (float)digit;
      if (digit && br_read(reader, 1u)) destination[index] = -destination[index];
      if (codebook == 11u && digit == 16u) {
        uint32_t escape = read_escape(reader);
        if (reader->error) return reader->error;
        destination[index] = (float)escape * (destination[index] < 0 ? -1.0f : 1.0f);
      }
    }
  }
  return AAC_OK;
}

static int32_t read_spectral_data(BitReader *reader, IcsInfo *info, uint32_t sample_rate,
                                  uint32_t channel) {
  const uint16_t *bands;
  uint32_t count = band_count(sample_rate, &bands);
  uint32_t sfb;
  uint32_t offset = 0;
  float values[4];
  for (sfb = 0; sfb < count; sfb++) {
    uint32_t width = bands[sfb + 1u] - bands[sfb];
    uint32_t codebook = sfb < info->max_sfb ? info->codebook[sfb] : 0u;
    uint32_t index;
    if (offset + width > VOLTA_AAC_FRAME_SAMPLES) return AAC_OVERFLOW;
    if (!codebook || codebook >= 13u) {
      for (index = 0; index < width; index++) spectrum[channel][offset + index] = 0.0f;
    } else {
      uint32_t dimension = codebook < 5u ? 4u : 2u;
      for (index = 0; index < width; index += dimension) {
        uint32_t component;
        int32_t status = read_spectral_value(reader, codebook, values);
        if (status) return status;
        for (component = 0; component < dimension && index + component < width; component++)
          spectrum[channel][offset + index + component] =
            (values[component] < 0.0f ? -1.0f : 1.0f) *
            magnitude_value((uint32_t)(values[component] < 0 ? -values[component] : values[component])) *
            scale_value((int32_t)info->scale[sfb] - 100);
      }
    }
    offset += width;
  }
  return AAC_OK;
}

static int32_t parse_channel(BitReader *reader, IcsInfo *shared, uint32_t common_window,
                             uint32_t sample_rate, uint32_t channel) {
  IcsInfo local;
  uint32_t global_gain = br_read(reader, 8u);
  int32_t status;
  if (reader->error) return reader->error;
  if (common_window) local = *shared;
  else {
    status = read_ics_info(reader, &local, sample_rate);
    if (status) return status;
    status = read_sections(reader, &local);
    if (status) return status;
  }
  status = read_scale_factors(reader, &local, global_gain);
  if (status) return status;
  if (br_read(reader, 1u) || br_read(reader, 1u) || br_read(reader, 1u))
    return AAC_UNSUPPORTED; /* pulse_data_present, tns_data_present, gain_control */
  return read_spectral_data(reader, &local, sample_rate, channel);
}

static void imdct_channel(uint32_t channel) {
  const double pi = 3.14159265358979323846;
  float transform[VOLTA_AAC_TRANSFORM_SAMPLES];
  uint32_t n;
  uint32_t k;
  for (n = 0; n < VOLTA_AAC_TRANSFORM_SAMPLES; n++) {
    double sum = 0.0;
    for (k = 0; k < VOLTA_AAC_FRAME_SAMPLES; k++)
      sum += (double)spectrum[channel][k] * vcos((pi / 1024.0) *
        ((double)n + 0.5 + 512.0) * ((double)k + 0.5));
    transform[n] = (float)(sum / 1024.0);
  }
  for (n = 0; n < VOLTA_AAC_FRAME_SAMPLES; n++) {
    float first = transform[n] * (float)vcos((pi * ((double)n + 0.5) / 2048.0) - pi * 0.5);
    float second = transform[n + VOLTA_AAC_FRAME_SAMPLES] *
      (float)vcos((pi * ((double)n + 1024.5) / 2048.0) - pi * 0.5);
    decoded[channel][n] = overlap[channel][n] + first;
    overlap[channel][n] = second;
  }
}

/* Return 1024 decoded interleaved float samples, or a negative AAC_* error. */
int32_t volta_aac_decode_frame(uint32_t packet_pointer, uint32_t packet_length,
                               uint32_t output_pointer, uint32_t output_capacity) {
  const uint8_t *packet = (const uint8_t *)(uintptr_t)packet_pointer;
  float *output = (float *)(uintptr_t)output_pointer;
  AdtsFrame frame;
  BitReader reader;
  IcsInfo shared;
  uint32_t channel;
  uint32_t common_window = 0;
  uint32_t decoded_channels = 0;
  int32_t status;
  if (!packet_pointer || !output_pointer || output_capacity < VOLTA_AAC_FRAME_SAMPLES)
    return AAC_OVERFLOW;
  status = parse_adts(packet, packet_length, &frame);
  if (status) return status;
  if (output_capacity < VOLTA_AAC_FRAME_SAMPLES * frame.channels) return AAC_OVERFLOW;
  reader.data = packet + frame.payload_offset;
  reader.length = frame.payload_length;
  reader.position = 0;
  reader.error = AAC_OK;
  for (channel = 0; channel < frame.channels; channel++) {
    uint32_t index;
    for (index = 0; index < VOLTA_AAC_FRAME_SAMPLES; index++) spectrum[channel][index] = 0.0f;
  }
  if (reader.error) return reader.error;
  status = AAC_INVALID;
  while (!reader.error && br_left(&reader) >= 3u && decoded_channels < frame.channels) {
    uint32_t element = br_read(&reader, 3u);
    if (element == 0u && decoded_channels < frame.channels) {
      br_skip(&reader, 4u); /* single_channel_element tag */
      status = parse_channel(&reader, &shared, 0u, frame.sample_rate, decoded_channels++);
    } else if (element == 1u && frame.channels == 2u && !decoded_channels) {
      uint32_t mask;
      br_skip(&reader, 4u); /* channel_pair_element tag */
      common_window = br_read(&reader, 1u);
      if (common_window) {
        status = read_ics_info(&reader, &shared, frame.sample_rate);
        if (!status) status = read_sections(&reader, &shared);
        if (!status) {
          mask = br_read(&reader, 2u);
          if (mask == 3u) return AAC_UNSUPPORTED;
          for (channel = 0; channel < shared.max_sfb; channel++)
            ms_used[channel] = mask == 2u ? (uint8_t)br_read(&reader, 1u) : (uint8_t)(mask == 1u);
        }
      } else status = AAC_OK;
      if (!status) status = parse_channel(&reader, &shared, common_window, frame.sample_rate, 0u);
      if (!status) status = parse_channel(&reader, &shared, common_window, frame.sample_rate, 1u);
      decoded_channels = status ? decoded_channels : 2u;
    } else if (element == 6u) {
      uint32_t count = br_read(&reader, 4u);
      if (count == 15u) count += br_read(&reader, 8u) - 1u;
      br_skip(&reader, count * 8u); /* fill_element */
    } else if (element == 4u) {
      uint32_t count;
      br_skip(&reader, 4u); /* data_stream_element tag */
      if (br_read(&reader, 1u)) br_skip(&reader, 7u);
      count = br_read(&reader, 8u);
      if (count == 255u) count += br_read(&reader, 8u) - 1u;
      br_skip(&reader, count * 8u);
    } else if (element == 7u) {
      break;
    } else {
      status = AAC_UNSUPPORTED;
      break;
    }
  }
  if (status || reader.error || decoded_channels != frame.channels)
    return status ? status : (reader.error ? reader.error : AAC_INVALID);
  if (frame.channels == 2u && common_window) {
    const uint16_t *bands;
    uint32_t count = band_count(frame.sample_rate, &bands);
    uint32_t sfb;
    for (sfb = 0; sfb < count && sfb < shared.max_sfb; sfb++) if (ms_used[sfb]) {
      uint32_t index;
      for (index = bands[sfb]; index < bands[sfb + 1u]; index++) {
        float left = spectrum[0][index];
        spectrum[0][index] = left + spectrum[1][index];
        spectrum[1][index] = left - spectrum[1][index];
      }
    }
  }
  for (channel = 0; channel < frame.channels; channel++) imdct_channel(channel);
  for (uint32_t index = 0; index < VOLTA_AAC_FRAME_SAMPLES; index++)
    for (channel = 0; channel < frame.channels; channel++)
      output[index * frame.channels + channel] = decoded[channel][index];
  last_sample_rate = frame.sample_rate;
  last_channels = frame.channels;
  return VOLTA_AAC_FRAME_SAMPLES;
}

uint32_t volta_aac_sample_rate(void) { return last_sample_rate; }
uint32_t volta_aac_channels(void) { return last_channels; }

extern unsigned char __heap_base;
uint32_t volta_aac_heap_base(void) { return (uint32_t)(uintptr_t)&__heap_base; }
