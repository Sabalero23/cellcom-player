export default class BaseDemuxer {
    constructor() {
        this.onError = null;
        this.onMediaInfo = null;
        this.onMetaDataArrived = null;
        this.onTrackMetadata = null;
        this.onDataAvailable = null;
        this.onTimedID3Metadata = null;
        this.onPGSSubtitleData = null;
        this.onSynchronousKLVMetadata = null;
        this.onAsynchronousKLVMetadata = null;
        this.onSMPTE2038Metadata = null;
        this.onSEI = null;
        this.onSCTE35Metadata = null;
        this.onPESPrivateData = null;
        this.onPESPrivateDataDescriptor = null;
    }
    destroy() {
        this.onError = null;
        this.onMediaInfo = null;
        this.onMetaDataArrived = null;
        this.onTrackMetadata = null;
        this.onDataAvailable = null;
        this.onTimedID3Metadata = null;
        this.onPGSSubtitleData = null;
        this.onSynchronousKLVMetadata = null;
        this.onAsynchronousKLVMetadata = null;
        this.onSMPTE2038Metadata = null;
        this.onSEI = null;
        this.onSCTE35Metadata = null;
        this.onPESPrivateData = null;
        this.onPESPrivateDataDescriptor = null;
    }
}
