/*
 * Copyright (C) 2023 zheng qian. All Rights Reserved.
 *
 * @author zheng qian <xqq@xqq.im>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
// Live buffer latency chaser by directly adjusting HTMLMediaElement.currentTime (not recommended)
class LiveLatencyChaser {
    constructor(config, media_element, on_direct_seek) {
        this._config = null;
        this._config = config;
        this._media_element = media_element;
        this._on_direct_seek = on_direct_seek;
    }
    destroy() {
        this._on_direct_seek = null;
        this._media_element = null;
        this._config = null;
    }
    notifyBufferedRangeUpdate() {
        this._chaseLiveLatency();
    }
    _chaseLiveLatency() {
        const buffered = this._media_element.buffered;
        const current_time = this._media_element.currentTime;
        const paused = this._media_element.paused;
        if (!this._config.isLive ||
            !this._config.liveBufferLatencyChasing ||
            buffered.length == 0 ||
            (!this._config.liveBufferLatencyChasingOnPaused && paused)) {
            return;
        }
        const buffered_end = buffered.end(buffered.length - 1);
        if (buffered_end > this._config.liveBufferLatencyMaxLatency) {
            if (buffered_end - current_time > this._config.liveBufferLatencyMaxLatency) {
                const target_time = buffered_end - this._config.liveBufferLatencyMinRemain;
                this._on_direct_seek(target_time);
            }
        }
    }
}
export default LiveLatencyChaser;
