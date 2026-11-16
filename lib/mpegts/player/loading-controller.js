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
import Log from '../utils/logger.js';
class LoadingController {
    constructor(config, media_element, on_pause_transmuxer, on_resume_transmuxer) {
        this.TAG = 'LoadingController';
        this._config = null;
        this._paused = false;
        this.e = null;
        this._config = config;
        this._media_element = media_element;
        this._on_pause_transmuxer = on_pause_transmuxer;
        this._on_resume_transmuxer = on_resume_transmuxer;
        this.e = {
            onMediaTimeUpdate: this._onMediaTimeUpdate.bind(this),
        };
    }
    destroy() {
        this._media_element.removeEventListener('timeupdate', this.e.onMediaTimeUpdate);
        this.e = null;
        this._media_element = null;
        this._config = null;
        this._on_pause_transmuxer = null;
        this._on_resume_transmuxer = null;
    }
    // buffered_position: in seconds
    notifyBufferedPositionChanged(buffered_position) {
        if (this._config.isLive || !this._config.lazyLoad) {
            return;
        }
        if (buffered_position == undefined) {
            this._suspendTransmuxerIfNeeded();
        }
        else {
            this._suspendTransmuxerIfBufferedPositionExceeded(buffered_position);
        }
    }
    _onMediaTimeUpdate(e) {
        if (this._paused) {
            this._resumeTransmuxerIfNeeded();
        }
    }
    _suspendTransmuxerIfNeeded() {
        const buffered = this._media_element.buffered;
        const current_time = this._media_element.currentTime;
        let current_range_end = 0;
        for (let i = 0; i < buffered.length; i++) {
            const start = buffered.start(i);
            const end = buffered.end(i);
            if (start <= current_time && current_time < end) {
                current_range_end = end;
                break;
            }
        }
        if (current_range_end > 0) {
            this._suspendTransmuxerIfBufferedPositionExceeded(current_range_end);
        }
    }
    _suspendTransmuxerIfBufferedPositionExceeded(buffered_end) {
        const current_time = this._media_element.currentTime;
        if (buffered_end >= current_time + this._config.lazyLoadMaxDuration && !this._paused) {
            Log.v(this.TAG, 'Maximum buffering duration exceeded, suspend transmuxing task');
            this.suspendTransmuxer();
            this._media_element.addEventListener('timeupdate', this.e.onMediaTimeUpdate);
        }
    }
    suspendTransmuxer() {
        this._paused = true;
        this._on_pause_transmuxer();
    }
    _resumeTransmuxerIfNeeded() {
        const buffered = this._media_element.buffered;
        const current_time = this._media_element.currentTime;
        const recover_duration = this._config.lazyLoadRecoverDuration;
        let should_resume = false;
        for (let i = 0; i < buffered.length; i++) {
            const from = buffered.start(i);
            const to = buffered.end(i);
            if (current_time >= from && current_time < to) {
                if (current_time >= to - recover_duration) {
                    should_resume = true;
                }
                break;
            }
        }
        if (should_resume) {
            Log.v(this.TAG, 'Continue loading from paused position');
            this.resumeTransmuxer();
            this._media_element.removeEventListener('timeupdate', this.e.onMediaTimeUpdate);
        }
    }
    resumeTransmuxer() {
        this._paused = false;
        this._on_resume_transmuxer();
    }
}
export default LoadingController;
