import Log from "../utils/logger.js";
export var H264NaluType;
(function (H264NaluType) {
    H264NaluType[H264NaluType["kUnspecified"] = 0] = "kUnspecified";
    H264NaluType[H264NaluType["kSliceNonIDR"] = 1] = "kSliceNonIDR";
    H264NaluType[H264NaluType["kSliceDPA"] = 2] = "kSliceDPA";
    H264NaluType[H264NaluType["kSliceDPB"] = 3] = "kSliceDPB";
    H264NaluType[H264NaluType["kSliceDPC"] = 4] = "kSliceDPC";
    H264NaluType[H264NaluType["kSliceIDR"] = 5] = "kSliceIDR";
    H264NaluType[H264NaluType["kSliceSEI"] = 6] = "kSliceSEI";
    H264NaluType[H264NaluType["kSliceSPS"] = 7] = "kSliceSPS";
    H264NaluType[H264NaluType["kSlicePPS"] = 8] = "kSlicePPS";
    H264NaluType[H264NaluType["kSliceAUD"] = 9] = "kSliceAUD";
    H264NaluType[H264NaluType["kEndOfSequence"] = 10] = "kEndOfSequence";
    H264NaluType[H264NaluType["kEndOfStream"] = 11] = "kEndOfStream";
    H264NaluType[H264NaluType["kFiller"] = 12] = "kFiller";
    H264NaluType[H264NaluType["kSPSExt"] = 13] = "kSPSExt";
    H264NaluType[H264NaluType["kReserved0"] = 14] = "kReserved0";
})(H264NaluType || (H264NaluType = {}));
export class H264NaluAVC1 {
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
export class H264AnnexBParser {
    constructor(data) {
        this.TAG = "H264AnnexBParser";
        this.current_startcode_offset_ = 0;
        this.eof_flag_ = false;
        this.data_ = data;
        this.current_startcode_offset_ = this.findNextStartCodeOffset(0);
        if (this.eof_flag_) {
            Log.e(this.TAG, "Could not find H264 startcode until payload end!");
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
            const nalu_type = data[offset] & 0x1F;
            const forbidden_bit = (data[offset] & 0x80) >>> 7;
            const next_startcode_offset = this.findNextStartCodeOffset(offset);
            this.current_startcode_offset_ = next_startcode_offset;
            if (nalu_type >= H264NaluType.kReserved0) {
                continue;
            }
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
export class AVCDecoderConfigurationRecord {
    // sps, pps: require Nalu without 4 byte length-header
    constructor(sps, pps, sps_details) {
        let length = 6 + 2 + sps.byteLength + 1 + 2 + pps.byteLength;
        let need_extra_fields = false;
        if (sps[3] !== 66 && sps[3] !== 77 && sps[3] !== 88) {
            need_extra_fields = true;
            length += 4;
        }
        const data = this.data = new Uint8Array(length);
        data[0] = 0x01; // configurationVersion
        data[1] = sps[1]; // AVCProfileIndication
        data[2] = sps[2]; // profile_compatibility
        data[3] = sps[3]; // AVCLevelIndication
        data[4] = 0xFF; // 111111 + lengthSizeMinusOne(3)
        data[5] = 0xE0 | 0x01; // 111 + numOfSequenceParameterSets
        const sps_length = sps.byteLength;
        data[6] = sps_length >>> 8; // sequenceParameterSetLength
        data[7] = sps_length & 0xFF;
        let offset = 8;
        data.set(sps, 8);
        offset += sps_length;
        data[offset] = 1; // numOfPictureParameterSets
        const pps_length = pps.byteLength;
        data[offset + 1] = pps_length >>> 8; // pictureParameterSetLength
        data[offset + 2] = pps_length & 0xFF;
        data.set(pps, offset + 3);
        offset += 3 + pps_length;
        if (need_extra_fields) {
            data[offset] = 0xFC | sps_details.chroma_format_idc;
            data[offset + 1] = 0xF8 | (sps_details.bit_depth_luma - 8);
            data[offset + 2] = 0xF8 | (sps_details.bit_depth_chroma - 8);
            data[offset + 3] = 0x00; // number of sps ext
            offset += 4;
        }
    }
    getData() {
        return this.data;
    }
}
