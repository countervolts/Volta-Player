export type AlacConfig = {
  frameLength: number;
  bitDepth: number;
  historyMult: number;
  initialHistory: number;
  riceLimit: number;
  channels: number;
  sampleRate: number;
};

type Atom = {
  type: string;
  start: number;
  end: number;
  payload: number;
};

export type AlacPacket = { offset: number; size: number };
export type AlacContainer = {
  config: AlacConfig;
  packets: AlacPacket[];
  totalFrames: number;
};

const fourcc = (bytes: Uint8Array, offset: number) =>
  String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );

const u32 = (view: DataView, offset: number) => view.getUint32(offset, false);

const u64 = (view: DataView, offset: number) =>
  view.getUint32(offset, false) * 0x1_0000_0000 +
  view.getUint32(offset + 4, false);

function atoms(bytes: Uint8Array, view: DataView, start: number, end: number) {
  const result: Atom[] = [];
  let cursor = start;
  while (cursor + 8 <= end) {
    let size = u32(view, cursor);
    let payload = cursor + 8;
    if (size === 1) {
      if (cursor + 16 > end) throw new Error("Malformed 64-bit M4A atom.");
      size = u64(view, cursor + 8);
      payload = cursor + 16;
    } else if (size === 0) {
      size = end - cursor;
    }
    if (!Number.isSafeInteger(size) || size < payload - cursor || cursor + size > end)
      throw new Error("Malformed M4A atom length.");
    result.push({ type: fourcc(bytes, cursor + 4), start: cursor, end: cursor + size, payload });
    cursor += size;
  }
  if (cursor !== end) throw new Error("Malformed M4A atom boundary.");
  return result;
}

function child(bytes: Uint8Array, view: DataView, parent: Atom, type: string) {
  return atoms(bytes, view, parent.payload, parent.end).find((atom) => atom.type === type);
}

function requiredChild(bytes: Uint8Array, view: DataView, parent: Atom, type: string) {
  const result = child(bytes, view, parent, type);
  if (!result) throw new Error(`ALAC M4A is missing its ${type} atom.`);
  return result;
}

function readSampleSizes(view: DataView, atom: Atom) {
  let cursor = atom.payload + 4;
  const fixedSize = u32(view, cursor);
  const count = u32(view, cursor + 4);
  cursor += 8;
  if (fixedSize) return Array<number>(count).fill(fixedSize);
  if (cursor + count * 4 > atom.end) throw new Error("Truncated ALAC sample-size table.");
  const sizes: number[] = [];
  for (let index = 0; index < count; index++, cursor += 4)
    sizes.push(u32(view, cursor));
  return sizes;
}

function readChunkOffsets(view: DataView, atom: Atom) {
  let cursor = atom.payload + 4;
  const count = u32(view, cursor);
  cursor += 4;
  const width = atom.type === "co64" ? 8 : 4;
  if (cursor + count * width > atom.end) throw new Error("Truncated ALAC chunk-offset table.");
  const offsets: number[] = [];
  for (let index = 0; index < count; index++, cursor += width) {
    const offset = width === 8 ? u64(view, cursor) : u32(view, cursor);
    if (!Number.isSafeInteger(offset)) throw new Error("ALAC file offset is too large for this browser.");
    offsets.push(offset);
  }
  return offsets;
}

function readChunkMap(view: DataView, atom: Atom) {
  let cursor = atom.payload + 4;
  const count = u32(view, cursor);
  cursor += 4;
  if (cursor + count * 12 > atom.end) throw new Error("Truncated ALAC chunk map.");
  const entries: { firstChunk: number; samplesPerChunk: number }[] = [];
  for (let index = 0; index < count; index++, cursor += 12) {
    entries.push({
      firstChunk: u32(view, cursor),
      samplesPerChunk: u32(view, cursor + 4),
    });
  }
  return entries;
}

function readFrameCount(view: DataView, atom: Atom) {
  let cursor = atom.payload + 4;
  const count = u32(view, cursor);
  cursor += 4;
  let total = 0;
  if (cursor + count * 8 > atom.end) throw new Error("Truncated ALAC timing table.");
  for (let index = 0; index < count; index++, cursor += 8)
    total += u32(view, cursor) * u32(view, cursor + 4);
  return total;
}

function parseConfig(bytes: Uint8Array, view: DataView, stsd: Atom) {
  let cursor = stsd.payload + 4;
  const entryCount = u32(view, cursor);
  cursor += 4;
  if (!entryCount || cursor + 36 > stsd.end) throw new Error("ALAC M4A has no audio sample entry.");
  const entrySize = u32(view, cursor);
  const entryType = fourcc(bytes, cursor + 4);
  const entryEnd = cursor + entrySize;
  if (entryType !== "alac" || entrySize < 36 || entryEnd > stsd.end)
    throw new Error("The selected file is not an ALAC M4A stream.");
  const configAtom = atoms(bytes, view, cursor + 36, entryEnd).find(
    (atom) => atom.type === "alac",
  );
  if (!configAtom || configAtom.payload + 28 > configAtom.end)
    throw new Error("ALAC M4A has no valid codec configuration.");
  const config = configAtom.payload + 4;
  return {
    frameLength: u32(view, config),
    bitDepth: bytes[config + 5],
    historyMult: bytes[config + 6],
    initialHistory: bytes[config + 7],
    riceLimit: bytes[config + 8],
    channels: bytes[config + 9],
    sampleRate: u32(view, config + 20),
  } satisfies AlacConfig;
}

function audioTrack(bytes: Uint8Array, view: DataView, moov: Atom) {
  for (const trak of atoms(bytes, view, moov.payload, moov.end).filter(
    (atom) => atom.type === "trak",
  )) {
    const mdia = child(bytes, view, trak, "mdia");
    if (!mdia) continue;
    const hdlr = child(bytes, view, mdia, "hdlr");
    if (hdlr && hdlr.payload + 12 <= hdlr.end && fourcc(bytes, hdlr.payload + 8) === "soun")
      return trak;
  }
  throw new Error("M4A contains no audio track.");
}

export function parseAlacM4a(data: ArrayBuffer): AlacContainer {
  const bytes = new Uint8Array(data);
  const view = new DataView(data);
  const moov = atoms(bytes, view, 0, bytes.length).find((atom) => atom.type === "moov");
  if (!moov) throw new Error("M4A is missing its movie atom.");
  const trak = audioTrack(bytes, view, moov);
  const mdia = requiredChild(bytes, view, trak, "mdia");
  const minf = requiredChild(bytes, view, mdia, "minf");
  const stbl = requiredChild(bytes, view, minf, "stbl");
  const stsd = requiredChild(bytes, view, stbl, "stsd");
  const stsz = requiredChild(bytes, view, stbl, "stsz");
  const stsc = requiredChild(bytes, view, stbl, "stsc");
  const stts = requiredChild(bytes, view, stbl, "stts");
  const offsets = child(bytes, view, stbl, "stco") ?? requiredChild(bytes, view, stbl, "co64");
  const config = parseConfig(bytes, view, stsd);
  const sizes = readSampleSizes(view, stsz);
  const chunkOffsets = readChunkOffsets(view, offsets);
  const chunkMap = readChunkMap(view, stsc);
  const packets: AlacPacket[] = [];
  let sampleIndex = 0;
  let mapIndex = 0;

  for (let chunkIndex = 1; chunkIndex <= chunkOffsets.length && sampleIndex < sizes.length; chunkIndex++) {
    while (
      mapIndex + 1 < chunkMap.length &&
      chunkMap[mapIndex + 1].firstChunk <= chunkIndex
    )
      mapIndex++;
    const mapping = chunkMap[mapIndex];
    if (!mapping || !mapping.samplesPerChunk) throw new Error("Invalid ALAC chunk map.");
    let offset = chunkOffsets[chunkIndex - 1];
    for (let packet = 0; packet < mapping.samplesPerChunk && sampleIndex < sizes.length; packet++) {
      const size = sizes[sampleIndex++];
      if (!size || offset + size > bytes.length) throw new Error("ALAC packet points outside the M4A file.");
      packets.push({ offset, size });
      offset += size;
    }
  }
  if (sampleIndex !== sizes.length) throw new Error("ALAC sample table is incomplete.");

  return { config, packets, totalFrames: readFrameCount(view, stts) };
}

type AlacWasmExports = {
  memory: WebAssembly.Memory;
  volta_alac_heap_base: () => number;
  volta_alac_decode_packet: (
    inputPointer: number,
    inputLength: number,
    bitDepth: number,
    historyMult: number,
    initialHistory: number,
    riceLimit: number,
    channels: number,
    frameLength: number,
    outputPointer: number,
    outputCapacity: number,
  ) => number;
};

let decoderModule: Promise<AlacWasmExports> | null = null;

async function alacModule() {
  if (!decoderModule) {
    decoderModule = fetch("/wasm/volta-alac.wasm")
      .then((response) => {
        if (!response.ok) throw new Error("The ALAC decoder could not be loaded.");
        return response.arrayBuffer();
      })
      .then((bytes) => WebAssembly.instantiate(bytes, {}))
      .then((instance) => instance.instance.exports as unknown as AlacWasmExports);
  }
  return decoderModule;
}

export class VoltaAlacDecoder {
  private constructor(
    private readonly wasm: AlacWasmExports,
    private readonly base: number,
  ) {}

  static async create() {
    const wasm = await alacModule();
    return new VoltaAlacDecoder(wasm, wasm.volta_alac_heap_base());
  }

  private reserve(bytes: number) {
    const current = this.wasm.memory.buffer.byteLength;
    if (bytes <= current) return;
    this.wasm.memory.grow(Math.ceil((bytes - current) / 65536));
  }

  decode(packet: Uint8Array, config: AlacConfig) {
    const input = this.base;
    const output = (input + packet.byteLength + 15) & ~15;
    const outputBytes = config.frameLength * config.channels * Int32Array.BYTES_PER_ELEMENT;
    this.reserve(output + outputBytes);
    new Uint8Array(this.wasm.memory.buffer, input, packet.byteLength).set(packet);
    const frames = this.wasm.volta_alac_decode_packet(
      input,
      packet.byteLength,
      config.bitDepth,
      config.historyMult,
      config.initialHistory,
      config.riceLimit,
      config.channels,
      config.frameLength,
      output,
      config.frameLength,
    );
    if (frames < 0) throw new Error(`ALAC decode failed (${frames}).`);
    return new Int32Array(
      this.wasm.memory.buffer,
      output,
      frames * config.channels,
    ).slice();
  }
}

export async function decodeAlacM4a(
  data: ArrayBuffer,
  audioContext: BaseAudioContext,
) {
  const container = parseAlacM4a(data);
  const decoder = await VoltaAlacDecoder.create();
  const buffer = audioContext.createBuffer(
    container.config.channels,
    container.totalFrames,
    container.config.sampleRate,
  );
  const channels = Array.from(
    { length: container.config.channels },
    () => new Float32Array(container.totalFrames),
  );
  const source = new Uint8Array(data);
  const scale = 2 ** (container.config.bitDepth - 1);
  let written = 0;

  for (let index = 0; index < container.packets.length; index++) {
    const packet = container.packets[index];
    const decoded = decoder.decode(
      source.subarray(packet.offset, packet.offset + packet.size),
      container.config,
    );
    const frames = decoded.length / container.config.channels;
    if (!Number.isInteger(frames) || written + frames > container.totalFrames)
      throw new Error("ALAC packet produced an invalid frame count.");
    for (let frame = 0; frame < frames; frame++)
      for (let channel = 0; channel < container.config.channels; channel++)
        channels[channel][written + frame] = decoded[frame * container.config.channels + channel] / scale;
    written += frames;
    if (index && index % 16 === 0)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  if (written !== container.totalFrames)
    throw new Error("ALAC timing table did not match decoded audio.");
  channels.forEach((channel, index) => buffer.copyToChannel(channel, index));
  return buffer;
}
