export class PAT {
    constructor() {
        // program_number -> pmt_pid
        this.program_pmt_pid = {};
    }
}
export var StreamType;
(function (StreamType) {
    StreamType[StreamType["kMPEG1Audio"] = 3] = "kMPEG1Audio";
    StreamType[StreamType["kMPEG2Audio"] = 4] = "kMPEG2Audio";
    StreamType[StreamType["kPESPrivateData"] = 6] = "kPESPrivateData";
    StreamType[StreamType["kADTSAAC"] = 15] = "kADTSAAC";
    StreamType[StreamType["kLOASAAC"] = 17] = "kLOASAAC";
    StreamType[StreamType["kAC3"] = 129] = "kAC3";
    StreamType[StreamType["kEAC3"] = 135] = "kEAC3";
    StreamType[StreamType["kMetadata"] = 21] = "kMetadata";
    StreamType[StreamType["kSCTE35"] = 134] = "kSCTE35";
    StreamType[StreamType["kPGS"] = 144] = "kPGS";
    StreamType[StreamType["kH264"] = 27] = "kH264";
    StreamType[StreamType["kH265"] = 36] = "kH265";
})(StreamType || (StreamType = {}));
export class PMT {
    constructor() {
        // pid -> stream_type
        this.pid_stream_type = {};
        this.common_pids = {
            h264: undefined,
            h265: undefined,
            av1: undefined,
            adts_aac: undefined,
            loas_aac: undefined,
            opus: undefined,
            ac3: undefined,
            eac3: undefined,
            mp3: undefined
        };
        this.pes_private_data_pids = {};
        this.timed_id3_pids = {};
        this.pgs_pids = {};
        this.pgs_langs = {};
        this.synchronous_klv_pids = {};
        this.asynchronous_klv_pids = {};
        this.scte_35_pids = {};
        this.smpte2038_pids = {};
    }
}
export class SliceQueue {
    constructor() {
        this.slices = [];
        this.total_length = 0;
        this.expected_length = 0;
        this.file_position = 0;
    }
}
