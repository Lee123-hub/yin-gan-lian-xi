#!/usr/bin/env python3
"""从 SF2 音色库中裁剪出只包含指定预置（默认 0 号钢琴）的精简版。

原理：SF2 是 RIFF 容器，采样数据在 sdta/smpl，乐器/预置映射在 pdta 的
phdr/pbag/pmod/pgen/inst/ibag/imod/igen/shdr 里。本脚本：
1. 找到 bank 0 / preset 0 的所有音区 -> 引用的乐器 -> 乐器音区引用的采样；
2. 只拷贝被引用的采样数据（sdta 大幅缩小）；
3. 重建 phdr/pbag/pgen/inst/ibag/igen/shdr，重映射所有 ID 与采样偏移；
4. pmod/imod 原样保留（袋子里 modIdx 不变）。

用法: python3 trim_sf2.py <输入.sf2> <输出.sf2> [preset号，逗号分隔，默认0]
"""
import struct
import sys


def read_chunks(data, pos, end):
    """迭代读取 (chunk_id, payload, 起始偏移)，pos..end 为区间。"""
    while pos + 8 <= end:
        cid = data[pos:pos + 4]
        size = struct.unpack_from('<I', data, pos + 4)[0]
        payload = data[pos + 8:pos + 8 + size]
        yield cid, payload, pos
        pos += 8 + size + (size & 1)  # RIFF 规定偶对齐


def parse(data):
    assert data[:4] == b'RIFF' and data[8:12] == b'sfbk', '不是 SF2 文件'
    riff_size = struct.unpack_from('<I', data, 4)[0]
    info = sdta = pdta = None
    for cid, payload, _ in read_chunks(data, 12, min(12 + riff_size, len(data))):
        if cid == b'LIST':
            ltype = payload[:4]
            if ltype == b'INFO':
                info = payload
            elif ltype == b'sdta':
                sdta = payload
            elif ltype == b'pdta':
                pdta = payload
    assert info and sdta and pdta, 'SF2 结构不完整'

    smpl = None
    for cid, payload, _ in read_chunks(sdta, 4, len(sdta)):
        if cid == b'smpl':
            smpl = payload

    chunks = {}
    for cid, payload, _ in read_chunks(pdta, 4, len(pdta)):
        chunks[cid] = payload  # phdr/pbag/pmod/pgen/inst/ibag/imod/igen/shdr
    return info, smpl, chunks


def records(payload, size):
    return [payload[i:i + size] for i in range(0, len(payload) - size + 1, size)]


def main():
    src_path, dst_path = sys.argv[1], sys.argv[2]
    keep_list = [int(x) for x in (sys.argv[3] if len(sys.argv) > 3 else '0').split(',')]
    data = open(src_path, 'rb').read()
    print(f'源文件: {len(data)/1048576:.1f} MB')

    info, smpl, ch = parse(data)

    # ---- 预置层 ----
    phdr = records(ch[b'phdr'], 38)
    pbag = records(ch[b'pbag'], 4)
    pgen = records(ch[b'pgen'], 4)
    presets = [struct.unpack('<20sHHHIII', r) for r in phdr]
    wanted = [i for i, p in enumerate(presets[:-1])
              if p[1] in keep_list and p[2] == 0]
    wanted.sort(key=lambda i: presets[i][3])  # 按 bagIdx 升序，保证区间连续
    assert wanted, f'bank0 里没找到 preset {keep_list}'
    print('保留预置:', [(presets[i][0].rstrip(b"\x00").decode('latin1'), presets[i][1]) for i in wanted])

    # 每个保留预置的音区区间 [presets[i].bagIdx, presets[i+1].bagIdx)
    zone_ranges = []
    for i in wanted:
        hi = presets[i + 1][3] if i + 1 < len(presets) else presets[-1][3]
        zone_ranges.append((presets[i][3], hi, i))

    # 预置音区 -> pgen 记录（zone b 的 gen 区间是 [bag[b].genIdx, bag[b+1].genIdx)）
    # modIdx 整体平移到 0 基（截掉 pmod 开头未被保留音区引用的记录）
    mod_base = struct.unpack_from('<H', pbag[zone_ranges[0][0]], 2)[0]
    preset_starts = []  # (新 pbag 中的起始 zone 序号, 预置记录索引)
    pgen_new, pbag_new, inst_ids = [], [], set()
    for lo, hi, wi in zone_ranges:
        preset_starts.append((len(pbag_new), wi))
        for b in range(lo, hi):
            g_lo = struct.unpack_from('<H', pbag[b], 0)[0]
            g_hi = struct.unpack_from('<H', pbag[b + 1], 0)[0]
            mod_idx = struct.unpack_from('<H', pbag[b], 2)[0] - mod_base
            new_g_start = len(pgen_new)
            for g in range(g_lo, g_hi):
                oper, amount = struct.unpack_from('<HH', pgen[g])
                if oper == 41:  # instrument
                    inst_ids.add(amount)
                    amount = 0  # 先占位，稍后回填重映射后的 ID
                pgen_new.append(struct.pack('<HH', oper, amount))
            pbag_new.append(struct.pack('<HH', new_g_start, mod_idx))

    # ---- 乐器层 ----
    insts = [struct.unpack('<20sH', r) for r in records(ch[b'inst'], 22)]
    ibag = records(ch[b'ibag'], 4)
    igen = records(ch[b'igen'], 4)

    inst_remap = {}
    imod_base = struct.unpack_from('<H', ibag[insts[min(inst_ids)][1]], 2)[0]
    inst_new, ibag_new, igen_new, sample_ids = [], [], [], set()
    for old_i in sorted(inst_ids):
        inst_remap[old_i] = len(inst_new)
        z_lo = insts[old_i][1]
        z_hi = insts[old_i + 1][1] if old_i + 1 < len(insts) else len(ibag)
        new_z_start = len(ibag_new)
        for z in range(z_lo, z_hi):
            g_lo = struct.unpack_from('<H', ibag[z], 0)[0]
            g_hi = struct.unpack_from('<H', ibag[z + 1], 0)[0]
            mod_idx = struct.unpack_from('<H', ibag[z], 2)[0] - imod_base
            new_g_start = len(igen_new)
            for g in range(g_lo, g_hi):
                oper, amount = struct.unpack_from('<HH', igen[g])
                if oper == 53:  # sampleID
                    sample_ids.add(amount)
                    amount = 0  # 占位，稍后回填
                igen_new.append(struct.pack('<HH', oper, amount))
            ibag_new.append(struct.pack('<HH', new_g_start, mod_idx))
        inst_new.append(struct.pack('<20sH', insts[old_i][0], new_z_start))

    igen_backfill = []
    for old_i in sorted(inst_ids):
        z_lo = insts[old_i][1]
        z_hi = insts[old_i + 1][1] if old_i + 1 < len(insts) else len(ibag)
        for z in range(z_lo, z_hi):
            g_lo = struct.unpack_from('<H', ibag[z], 0)[0]
            g_hi = struct.unpack_from('<H', ibag[z + 1], 0)[0]
            for g in range(g_lo, g_hi):
                if struct.unpack_from('<H', igen[g])[0] == 53:
                    igen_backfill.append((old_i, g))

    # ---- 采样层 ----
    shdrs = [struct.unpack('<20sIIIIiBbHH', r) for r in records(ch[b'shdr'], 46)]
    sample_remap = {}
    smpl_new = bytearray()
    shdr_new = []
    for old_s in sorted(sample_ids):
        name, start, end, sl, el, rate, pitch, corr, link, stype = shdrs[old_s]
        delta = len(smpl_new) // 2 - start
        smpl_new += smpl[start * 2:end * 2]
        sample_remap[old_s] = len(shdr_new)
        shdr_new.append(struct.pack('<20sIIIIiBbHH', name, start + delta, end + delta,
                                    sl + delta, el + delta, rate, pitch, corr,
                                    link, stype))
    smpl_new += b'\x00' * 92  # 规范要求末尾至少 46 个零采样

    # 回填 sampleLink（立体声配对）
    for old_s in sorted(sample_ids):
        name, start, end, sl, el, rate, pitch, corr, link, stype = shdrs[old_s]
        if link in sample_remap:
            new_rec = bytearray(shdr_new[sample_remap[old_s]])
            struct.pack_into('<H', new_rec, 36, sample_remap[link])
            shdr_new[sample_remap[old_s]] = bytes(new_rec)

    # 回填 igen 的 sampleID：按与生成时完全相同的顺序遍历
    igen_buf = bytearray(b''.join(igen_new))
    pos = 0
    for old_i in sorted(inst_ids):
        z_lo = insts[old_i][1]
        z_hi = insts[old_i + 1][1] if old_i + 1 < len(insts) else len(ibag)
        for z in range(z_lo, z_hi):
            g_lo = struct.unpack_from('<H', ibag[z], 0)[0]
            g_hi = struct.unpack_from('<H', ibag[z + 1], 0)[0]
            for g in range(g_lo, g_hi):
                oper, amount = struct.unpack_from('<HH', igen[g])
                if oper == 53:
                    struct.pack_into('<H', igen_buf, pos * 4 + 2, sample_remap[amount])
                pos += 1
    igen_new = bytes(igen_buf)

    # 回填 pgen 的 instrument ID
    pgen_buf = bytearray(b''.join(pgen_new))
    pos = 0
    for lo, hi, _wi in zone_ranges:
        for b in range(lo, hi):
            g_lo = struct.unpack_from('<H', pbag[b], 0)[0]
            g_hi = struct.unpack_from('<H', pbag[b + 1], 0)[0]
            for g in range(g_lo, g_hi):
                oper, amount = struct.unpack_from('<HH', pgen[g])
                if oper == 41:
                    struct.pack_into('<H', pgen_buf, pos * 4 + 2, inst_remap[amount])
                pos += 1
    pgen_new = bytes(pgen_buf)

    # ---- 终结记录 ----
    # pmod/imod 头尾都按保留音区的实际引用范围截取：
    # [首个被引用音区的 modIdx, 最后一个保留音区的上界)，再补上原 chunk 的终结记录
    last_inst = sorted(inst_ids)[-1]
    if last_inst + 1 < len(insts):
        imod_end = struct.unpack_from('<H', ibag[insts[last_inst + 1][1]], 2)[0]
    else:
        imod_end = len(records(ch[b'imod'], 10)) - 1  # 原 imod 终结记录的 modIdx
    pmod_end = struct.unpack_from('<H', pbag[zone_ranges[-1][1]], 2)[0]
    pmod_new = ch[b'pmod'][mod_base * 10:pmod_end * 10] + ch[b'pmod'][-10:]
    imod_new = ch[b'imod'][imod_base * 10:imod_end * 10] + ch[b'imod'][-10:]
    pbag_new.append(struct.pack('<HH', len(pgen_new) // 4, pmod_end - mod_base))
    ibag_new.append(struct.pack('<HH', len(igen_new) // 4, imod_end - imod_base))
    inst_new.append(struct.pack('<20sH', b'EOS', len(ibag_new) - 1))
    phdr_new = []
    for new_start, wi in preset_starts:
        p = presets[wi]
        phdr_new.append(struct.pack('<20sHHHIII', p[0], p[1], p[2], new_start, 0, 0, 0))
    phdr_new.append(struct.pack('<20sHHHIII', b'EOP', len(phdr_new), 128, len(pbag_new) - 1, 0, 0, 0))
    shdr_new.append(struct.pack('<20sIIIIiBbHH', b'EOS', 0, 0, 0, 0, 0, 0, 0, 0, 0))

    # ---- 组装 RIFF ----
    def chunk(cid, payload):
        return cid + struct.pack('<I', len(payload)) + payload + (b'\x00' if len(payload) & 1 else b'')

    def lst(lid, payload):
        return chunk(b'LIST', lid + payload)

    pdta_new = (chunk(b'phdr', b''.join(phdr_new)) + chunk(b'pbag', b''.join(pbag_new))
                + chunk(b'pmod', pmod_new) + chunk(b'pgen', pgen_new)
                + chunk(b'inst', b''.join(inst_new)) + chunk(b'ibag', b''.join(ibag_new))
                + chunk(b'imod', imod_new) + chunk(b'igen', igen_new)
                + chunk(b'shdr', b''.join(shdr_new)))
    out = (b'RIFF' + struct.pack('<I', 4) + b'sfbk'
           + lst(b'INFO', info[4:])
           + lst(b'sdta', chunk(b'smpl', bytes(smpl_new)))
           + lst(b'pdta', pdta_new))
    out = bytearray(out)
    struct.pack_into('<I', out, 4, len(out) - 8)
    out = bytes(out)

    open(dst_path, 'wb').write(out)
    print(f'输出: {len(out)/1048576:.1f} MB（采样 {len(sample_ids)} 个 / 原 {len(shdrs)-1} 个，'
          f'乐器 {len(inst_new)-1} 个 / 原 {len(insts)-1} 个）')


if __name__ == '__main__':
    main()
