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
import PlayerEngineMainThread from './player-engine-main-thread.js';
import PlayerEngineDedicatedThread from './player-engine-dedicated-thread.js';
import { InvalidArgumentException } from '../utils/exception.js';
class MSEPlayer {
    constructor(mediaDataSource, config) {
        this.TAG = 'MSEPlayer';
        this._type = 'MSEPlayer';
        this._media_element = null;
        const typeLowerCase = mediaDataSource.type.toLowerCase();
        if (typeLowerCase !== 'mse'
            && typeLowerCase !== 'mpegts'
            && typeLowerCase !== 'm2ts'
            && typeLowerCase !== 'flv') {
            throw new InvalidArgumentException('MSEPlayer requires an mpegts/m2ts/flv MediaDataSource input!');
        }
        if (config && config.enableWorkerForMSE && PlayerEngineDedicatedThread.isSupported()) {
            try {
                this._player_engine = new PlayerEngineDedicatedThread(mediaDataSource, config);
            }
            catch (error) {
                Log.e(this.TAG, 'Error while initializing PlayerEngineDedicatedThread, fallback to PlayerEngineMainThread');
                this._player_engine = new PlayerEngineMainThread(mediaDataSource, config);
            }
        }
        else {
            this._player_engine = new PlayerEngineMainThread(mediaDataSource, config);
        }
    }
    destroy() {
        this._player_engine.destroy();
        this._player_engine = null;
        this._media_element = null;
    }
    on(event, listener) {
        this._player_engine.on(event, listener);
    }
    off(event, listener) {
        this._player_engine.off(event, listener);
    }
    attachMediaElement(mediaElement) {
        this._media_element = mediaElement;
        this._player_engine.attachMediaElement(mediaElement);
    }
    detachMediaElement() {
        this._media_element = null;
        this._player_engine.detachMediaElement();
    }
    load() {
        this._player_engine.load();
    }
    unload() {
        this._player_engine.unload();
    }
    play() {
        return this._player_engine.play();
    }
    pause() {
        this._player_engine.pause();
    }
    get type() {
        return this._type;
    }
    get buffered() {
        return this._media_element.buffered;
    }
    get duration() {
        return this._media_element.duration;
    }
    get volume() {
        return this._media_element.volume;
    }
    set volume(value) {
        this._media_element.volume = value;
    }
    get muted() {
        return this._media_element.muted;
    }
    set muted(muted) {
        this._media_element.muted = muted;
    }
    get currentTime() {
        if (this._media_element) {
            return this._media_element.currentTime;
        }
        return 0;
    }
    set currentTime(seconds) {
        this._player_engine.seek(seconds);
    }
    get mediaInfo() {
        // PlayerEngine.mediaInfo is `MediaInfo | undefined` (nothing is known until the
        // engine reports it), but the public Player interface declares mediaInfo as
        // always-present. Assert rather than change that published contract.
        return this._player_engine.mediaInfo;
    }
    get statisticsInfo() {
        return this._player_engine.statisticsInfo;
    }
}
export default MSEPlayer;
