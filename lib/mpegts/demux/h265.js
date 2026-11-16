import Log from "../utils/logger.js";
export var H265NaluType;
(function (H265NaluType) {
    H265NaluType[H265NaluType["kSliceIDR_W_RADL"] = 19] = "kSliceIDR_W_RADL";
    H265NaluType[H265NaluType["kSliceIDR_N_LP"] = 20] = "kSliceIDR_N_LP";
    H265NaluType[H265NaluType["kSliceCRA_NUT"] = 21] = "kSliceCRA_NUT";
    H265NaluType[H265NaluType["kSliceVPS"] = 32] = "kSliceVPS";
    H265NaluType[H265NaluType["kSliceSPS"] = 33] = "kSliceSPS";
    H265NaluType[H265NaluType["kSlicePPS"] = 34] = "kSlicePPS";
    H265NaluType[H265NaluType["kSliceAUD"] = 35] = "kSliceAUD";
    H265NaluType[H265NaluType["kSliceSEI"] = 39] = "kSliceSEI";
    H265NaluType[H265NaluType["kSliceSEISuffix"] = 40] = "kSliceSEISuffix";
})(H265NaluType || (H265NaluType = {}));
export class H265NaluHVC1 {
    constructor(nalu) {
        const nalu_size = nalu.data.byteLength;
        this.type = nalu.type;
        this.data = new Uint8Array(4 + nalu_size); // 4 byte length-header + nalu payload
        const v = new DataView(this.data.buffer);
        // Fill 4 byte length-header
        v.setUint32(0, nalu_size);
        // Copy payload
        this.data.set(nalu.data, 4);
    }
}
export class H265AnnexBParser {
    constructor(data) {
        this.TAG = "H265AnnexBParser";
        this.current_startcode_offset_ = 0;
        this.eof_flag_ = false;
        this.data_ = data;
        this.current_startcode_offset_ = this.findNextStartCodeOffset(0);
        if (this.eof_flag_) {
            Log.e(this.TAG, "Could not find H265 startcode until payload end!");
        }
    }
    findNextStartCodeOffset(start_offset) {
        let i = start_offset;
        const data = this.data_;
        while (true) {
            if (i + 3 >= data.byteLength) {
                this.eof_flag_ = true;
                return data.byteLength;
            }
            // search 00 00 00 01 or 00 00 01
            const uint32 = (data[i + 0] << 24)
                | (data[i + 1] << 16)
                | (data[i + 2] << 8)
                | (data[i + 3]);
            const uint24 = (data[i + 0] << 16)
                | (data[i + 1] << 8)
                | (data[i + 2]);
            if (uint32 === 0x00000001 || uint24 === 0x000001) {
                return i;
            }
            else {
                i++;
            }
        }
    }
    readNextNaluPayload() {
        const data = this.data_;
        let nalu_payload = null;
        while (nalu_payload == null) {
            if (this.eof_flag_) {
                break;
            }
            // offset pointed to start code
            const startcode_offset = this.current_startcode_offset_;
            // nalu payload start offset
            let offset = startcode_offset;
            const u32 = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | (data[offset + 3]);
            if (u32 === 0x00000001) {
                offset += 4;
            }
            else {
                offset += 3;
            }
            const nalu_type = (data[offset] >> 1) & 0x3F;
            const forbidden_bit = (data[offset] & 0x80) >>> 7;
            const next_startcode_offset = this.findNextStartCodeOffset(offset);
            this.current_startcode_offset_ = next_startcode_offset;
            if (forbidden_bit !== 0) {
                // Log.e(this.TAG, `forbidden_bit near offset ${offset} should be 0 but has value ${forbidden_bit}`);
                continue;
            }
            const payload_data = data.subarray(offset, next_startcode_offset);
            nalu_payload = {
                type: nalu_type,
                data: payload_data,
            };
        }
        return nalu_payload;
    }
}
export class HEVCDecoderConfigurationRecord {
    // sps, pps: require Nalu without 4 byte length-header
    constructor(vps, sps, pps, detail) {
        const length = 23 + (3 + 2 + vps.byteLength) + (3 + 2 + sps.byteLength) + (3 + 2 + pps.byteLength);
        const data = this.data = new Uint8Array(length);
        data[0] = 0x01; // configurationVersion
        data[1] = ((detail.general_profile_space & 0x03) << 6) | ((detail.general_tier_flag ? 1 : 0) << 5) | ((detail.general_profile_idc & 0x1F));
        data[2] = detail.general_profile_compatibility_flags_1;
        data[3] = detail.general_profile_compatibility_flags_2;
        data[4] = detail.general_profile_compatibility_flags_3;
        data[5] = detail.general_profile_compatibility_flags_4;
        data[6] = detail.general_constraint_indicator_flags_1;
        data[7] = detail.general_constraint_indicator_flags_2;
        data[8] = detail.general_constraint_indicator_flags_3;
        data[9] = detail.general_constraint_indicator_flags_4;
        data[10] = detail.general_constraint_indicator_flags_5;
        data[11] = detail.general_constraint_indicator_flags_6;
        data[12] = detail.general_level_idc;
        data[13] = 0xF0 | ((detail.min_spatial_segmentation_idc & 0x0F00) >> 8);
        data[14] = (detail.min_spatial_segmentation_idc & 0xFF);
        data[15] = 0xFC | (detail.parallelismType & 0x03);
        data[16] = 0xFC | (detail.chroma_format_idc & 0x03);
        data[17] = 0xF8 | (detail.bit_depth_luma_minus8 & 0x07);
        data[18] = 0xF8 | (detail.bit_depth_chroma_minus8 & 0x07);
        data[19] = 0;
        data[20] = 0;
        data[21] = ((detail.constant_frame_rate & 0x03) << 6) | ((detail.num_temporal_layers & 0x07) << 3) | ((detail.temporal_id_nested ? 1 : 0) << 2) | 3;
        data[22] = 3;
        data[23 + 0 + 0] = 0x80 | H265NaluType.kSliceVPS;
        data[23 + 0 + 1] = 0;
        data[23 + 0 + 2] = 1;
        data[23 + 0 + 3] = (vps.byteLength & 0xFF00) >> 8;
        data[23 + 0 + 4] = (vps.byteLength & 0x00FF) >> 0;
        data.set(vps, 23 + 0 + 5);
        data[23 + (5 + vps.byteLength) + 0] = 0x80 | H265NaluType.kSliceSPS;
        data[23 + (5 + vps.byteLength) + 1] = 0;
        data[23 + (5 + vps.byteLength) + 2] = 1;
        data[23 + (5 + vps.byteLength) + 3] = (sps.byteLength & 0xFF00) >> 8;
        data[23 + (5 + vps.byteLength) + 4] = (sps.byteLength & 0x00FF) >> 0;
        data.set(sps, 23 + (5 + vps.byteLength) + 5);
        data[23 + (5 + vps.byteLength + 5 + sps.byteLength) + 0] = 0x80 | H265NaluType.kSlicePPS;
        data[23 + (5 + vps.byteLength + 5 + sps.byteLength) + 1] = 0;
        data[23 + (5 + vps.byteLength + 5 + sps.byteLength) + 2] = 1;
        data[23 + (5 + vps.byteLength + 5 + sps.byteLength) + 3] = (pps.byteLength & 0xFF00) >> 8;
        data[23 + (5 + vps.byteLength + 5 + sps.byteLength) + 4] = (pps.byteLength & 0x00FF) >> 0;
        data.set(pps, 23 + (5 + vps.byteLength + 5 + sps.byteLength) + 5);
    }
    getData() {
        return this.data;
    }
}
