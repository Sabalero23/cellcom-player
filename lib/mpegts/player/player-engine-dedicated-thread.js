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
import { EventEmitter } from '../events.js';
import work from '../utils/webworkify-webpack.js';
import Log from '../utils/logger.js';
import LoggingControl from '../utils/logging-control.js';
import { createDefaultConfig } from '../config.js';
import MSEEvents from '../core/mse-events.js';
import PlayerEvents from './player-events.js';
import TransmuxingEvents from '../core/transmuxing-events.js';
import SeekingHandler from './seeking-handler.js';
import LoadingController from './loading-controller.js';
import StartupStallJumper from './startup-stall-jumper.js';
import LiveLatencyChaser from './live-latency-chaser.js';
import LiveLatencySynchronizer from './live-latency-synchronizer.js';
class PlayerEngineDedicatedThread {
    static isSupported() {
        if (!self.Worker) {
            return false;
        }
        if (self.MediaSource &&
            ('canConstructInDedicatedWorker' in self.MediaSource) &&
            (self.MediaSource['canConstructInDedicatedWorker'] === true)) {
            return true;
        }
        if (self.ManagedMediaSource &&
            ('canConstructInDedicatedWorker' in self.ManagedMediaSource) &&
            (self.ManagedMediaSource['canConstructInDedicatedWorker'] === true)) {
            return true;
        }
        return false;
    }
    constructor(mediaDataSource, config) {
        this.TAG = 'PlayerEngineDedicatedThread';
        this._emitter = new EventEmitter();
        this._media_element = null;
        this._worker_destroying = false;
        this._seeking_handler = null;
        this._loading_controller = null;
        this._startup_stall_jumper = null;
        this._live_latency_chaser = null;
        this._live_latency_synchronizer = null;
        this._pending_seek_time = null;
        this._media_info = null;
        this._statistics_info = null;
        this.e = null;
        this._media_data_source = mediaDataSource;
        this._config = createDefaultConfig();
        if (typeof config === 'object') {
            Object.assign(this._config, config);
        }
        if (mediaDataSource.isLive === true) {
            this._config.isLive = true;
        }
        this.e = {
            onLoggingConfigChanged: this._onLoggingConfigChanged.bind(this),
            onMediaLoadedMetadata: this._onMediaLoadedMetadata.bind(this),
            onMediaTimeUpdate: this._onMediaTimeUpdate.bind(this),
            onMediaReadyStateChanged: this._onMediaReadyStateChange.bind(this),
        };
        LoggingControl.registerListener(this.e.onLoggingConfigChanged);
        this._worker = work(require.resolve('./player-engine-worker'), { all: true });
        this._worker.addEventListener('message', this._onWorkerMessage.bind(this));
        this._worker.postMessage({
            cmd: 'init',
            media_data_source: this._media_data_source,
            config: this._config
        });
        this._worker.postMessage({
            cmd: 'logging_config',
            logging_config: LoggingControl.getConfig()
        });
    }
    destroy() {
        this._emitter.emit(PlayerEvents.DESTROYING);
        this.unload();
        this.detachMediaElement();
        this._worker_destroying = true;
        this._worker.postMessage({
            cmd: 'destroy'
        });
        LoggingControl.removeListener(this.e.onLoggingConfigChanged);
        this.e = null;
        this._media_data_source = null;
        this._emitter.removeAllListeners();
        this._emitter = null;
    }
    on(event, listener) {
        this._emitter.addListener(event, listener);
        // For media_info / statistics_info event, trigger it immediately
        if (event === PlayerEvents.MEDIA_INFO && this._media_info) {
            Promise.resolve().then(() => this._emitter.emit(PlayerEvents.MEDIA_INFO, this.mediaInfo));
        }
        else if (event == PlayerEvents.STATISTICS_INFO && this._statistics_info) {
            Promise.resolve().then(() => this._emitter.emit(PlayerEvents.STATISTICS_INFO, this.statisticsInfo));
        }
    }
    off(event, listener) {
        this._emitter.removeListener(event, listener);
    }
    attachMediaElement(mediaElement) {
        this._media_element = mediaElement;
        // Remove src / srcObject of HTMLMediaElement for cleanup
        this._media_element.src = '';
        this._media_element.removeAttribute('src');
        this._media_element.srcObject = null;
        this._media_element.load();
        this._media_element.addEventListener('loadedmetadata', this.e.onMediaLoadedMetadata);
        this._media_element.addEventListener('timeupdate', this.e.onMediaTimeUpdate);
        this._media_element.addEventListener('readystatechange', this.e.onMediaReadyStateChanged);
        this._worker.postMessage({
            cmd: 'initialize_mse',
        });
        // Then wait for 'mse_init' message from worker to receive MediaSource handle
    }
    detachMediaElement() {
        this._worker.postMessage({
            cmd: 'shutdown_mse',
        });
        if (this._media_element) {
            // Remove all appended event listeners
            this._media_element.removeEventListener('loadedmetadata', this.e.onMediaLoadedMetadata);
            this._media_element.removeEventListener('timeupdate', this.e.onMediaTimeUpdate);
            this._media_element.removeEventListener('readystatechange', this.e.onMediaReadyStateChanged);
            // Detach media source from media element
            this._media_element.src = '';
            this._media_element.removeAttribute('src');
            this._media_element.srcObject = null;
            this._media_element.load();
            this._media_element = null;
        }
    }
    load() {
        this._worker.postMessage({
            cmd: 'load',
        });
        this._seeking_handler = new SeekingHandler(this._config, this._media_element, this._onRequiredUnbufferedSeek.bind(this));
        this._loading_controller = new LoadingController(this._config, this._media_element, this._onRequestPauseTransmuxer.bind(this), this._onRequestResumeTransmuxer.bind(this));
        this._startup_stall_jumper = new StartupStallJumper(this._media_element, this._onRequestDirectSeek.bind(this));
        if (this._config.isLive && this._config.liveBufferLatencyChasing) {
            this._live_latency_chaser = new LiveLatencyChaser(this._config, this._media_element, this._onRequestDirectSeek.bind(this));
        }
        if (this._config.isLive && this._config.liveSync) {
            this._live_latency_synchronizer = new LiveLatencySynchronizer(this._config, this._media_element);
        }
        // Reset currentTime to 0
        if (this._media_element.readyState > 0) {
            // IE11 may throw InvalidStateError if readyState === 0
            this._seeking_handler.directSeek(0);
        }
    }
    unload() {
        var _a, _b, _c, _d, _e, _f;
        (_a = this._media_element) === null || _a === void 0 ? void 0 : _a.pause();
        this._worker.postMessage({
            cmd: 'unload',
        });
        (_b = this._live_latency_synchronizer) === null || _b === void 0 ? void 0 : _b.destroy();
        this._live_latency_synchronizer = null;
        (_c = this._live_latency_chaser) === null || _c === void 0 ? void 0 : _c.destroy();
        this._live_latency_chaser = null;
        (_d = this._startup_stall_jumper) === null || _d === void 0 ? void 0 : _d.destroy();
        this._startup_stall_jumper = null;
        (_e = this._loading_controller) === null || _e === void 0 ? void 0 : _e.destroy();
        this._loading_controller = null;
        (_f = this._seeking_handler) === null || _f === void 0 ? void 0 : _f.destroy();
        this._seeking_handler = null;
    }
    play() {
        return this._media_element.play();
    }
    pause() {
        this._media_element.pause();
    }
    seek(seconds) {
        if (this._media_element && this._seeking_handler) {
            this._seeking_handler.seek(seconds);
        }
        else {
            this._pending_seek_time = seconds;
        }
    }
    get mediaInfo() {
        return Object.assign({}, this._media_info);
    }
    get statisticsInfo() {
        return Object.assign({}, this._statistics_info);
    }
    _onLoggingConfigChanged(config) {
        var _a;
        (_a = this._worker) === null || _a === void 0 ? void 0 : _a.postMessage({
            cmd: 'logging_config',
            logging_config: config,
        });
    }
    _onMSEUpdateEnd() {
        if (this._config.isLive && this._config.liveBufferLatencyChasing && this._live_latency_chaser) {
            this._live_latency_chaser.notifyBufferedRangeUpdate();
        }
        this._loading_controller.notifyBufferedPositionChanged();
    }
    _onMSEBufferFull() {
        Log.v(this.TAG, 'MSE SourceBuffer is full, suspend transmuxing task');
        this._loading_controller.suspendTransmuxer();
    }
    _onMediaLoadedMetadata(e) {
        if (this._pending_seek_time != null) {
            this._seeking_handler.seek(this._pending_seek_time);
            this._pending_seek_time = null;
        }
    }
    _onRequestDirectSeek(target) {
        this._seeking_handler.directSeek(target);
    }
    _onRequiredUnbufferedSeek(milliseconds) {
        this._worker.postMessage({
            cmd: 'unbuffered_seek',
            milliseconds: milliseconds
        });
    }
    _onRequestPauseTransmuxer() {
        this._worker.postMessage({
            cmd: 'pause_transmuxer'
        });
    }
    _onRequestResumeTransmuxer() {
        this._worker.postMessage({
            cmd: 'resume_transmuxer'
        });
    }
    _onMediaTimeUpdate(e) {
        this._worker.postMessage({
            cmd: 'timeupdate',
            current_time: e.target.currentTime,
        });
    }
    _onMediaReadyStateChange(e) {
        this._worker.postMessage({
            cmd: 'readystatechange',
            ready_state: e.target.readyState,
        });
    }
    _onWorkerMessage(e) {
        var _a;
        const message_packet = e.data;
        const msg = message_packet.msg;
        if (msg == 'destroyed' || this._worker_destroying) {
            this._worker_destroying = false;
            (_a = this._worker) === null || _a === void 0 ? void 0 : _a.terminate();
            this._worker = null;
            return;
        }
        switch (msg) {
            case 'mse_init': {
                const packet = message_packet;
                // Use ManagedMediaSource only if w3c MediaSource is not available (e.g. iOS Safari)
                const use_managed_media_source = (typeof self.ManagedMediaSource === 'function') && !(typeof self.MediaSource === 'function');
                if (use_managed_media_source) {
                    // When using ManagedMediaSource, MediaSource will not open unless disableRemotePlayback is set to true
                    this._media_element['disableRemotePlayback'] = true;
                }
                // Attach to HTMLMediaElement by using MediaSource Handle
                this._media_element.srcObject = packet.handle;
                break;
            }
            case 'mse_event': {
                const packet = message_packet;
                if (packet.event == MSEEvents.UPDATE_END) {
                    this._onMSEUpdateEnd();
                }
                else if (packet.event == MSEEvents.BUFFER_FULL) {
                    this._onMSEBufferFull();
                }
                break;
            }
            case 'transmuxing_event': {
                const packet = message_packet;
                if (packet.event == TransmuxingEvents.MEDIA_INFO) {
                    const packet = message_packet;
                    this._media_info = packet.info;
                    this._emitter.emit(PlayerEvents.MEDIA_INFO, Object.assign({}, packet.info));
                }
                else if (packet.event == TransmuxingEvents.STATISTICS_INFO) {
                    const packet = message_packet;
                    this._statistics_info = this._fillStatisticsInfo(packet.info);
                    this._emitter.emit(PlayerEvents.STATISTICS_INFO, Object.assign({}, packet.info));
                }
                else if (packet.event == TransmuxingEvents.RECOMMEND_SEEKPOINT) {
                    const packet = message_packet;
                    if (this._media_element && !this._config.accurateSeek) {
                        this._seeking_handler.directSeek(packet.milliseconds / 1000);
                    }
                }
                break;
            }
            case 'player_event': {
                const packet = message_packet;
                if (packet.event == PlayerEvents.ERROR) {
                    const packet = message_packet;
                    this._emitter.emit(PlayerEvents.ERROR, packet.error_type, packet.error_detail, packet.info);
                }
                else if ('extraData' in packet) {
                    const packet = message_packet;
                    this._emitter.emit(packet.event, packet.extraData);
                }
                break;
            }
            case 'logcat_callback': {
                const packet = message_packet;
                Log.emitter.emit('log', packet.type, packet.logcat);
                break;
            }
            case 'buffered_position_changed': {
                const packet = message_packet;
                this._loading_controller.notifyBufferedPositionChanged(packet.buffered_position_milliseconds / 1000);
                break;
            }
        }
    }
    _fillStatisticsInfo(stat_info) {
        stat_info.playerType = 'MSEPlayer';
        if (!(this._media_element instanceof HTMLVideoElement)) {
            return stat_info;
        }
        let has_quality_info = true;
        let decoded = 0;
        let dropped = 0;
        if (this._media_element.getVideoPlaybackQuality) {
            const quality = this._media_element.getVideoPlaybackQuality();
            decoded = quality.totalVideoFrames;
            dropped = quality.droppedVideoFrames;
        }
        else if (this._media_element['webkitDecodedFrameCount'] != undefined) {
            decoded = this._media_element['webkitDecodedFrameCount'];
            // Guarded above by the webkitDecodedFrameCount probe; a browser exposing one
            // counter exposes both, so assert rather than defaulting and changing the value.
            dropped = this._media_element['webkitDroppedFrameCount'];
        }
        else {
            has_quality_info = false;
        }
        if (has_quality_info) {
            stat_info.decodedFrames = decoded;
            stat_info.droppedFrames = dropped;
        }
        return stat_info;
    }
}
export default PlayerEngineDedicatedThread;
