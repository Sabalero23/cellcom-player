// Cellcom: EventEmitter mínimo compatible con el módulo 'events' de Node, para el navegador.
class EventEmitter {
    constructor() { this._ev = Object.create(null); }
    on(n, f) { (this._ev[n] || (this._ev[n] = [])).push(f); return this; }
    addListener(n, f) { return this.on(n, f); }
    once(n, f) { const w = (...a) => { this.off(n, w); f.apply(this, a); }; w._orig = f; return this.on(n, w); }
    off(n, f) { const l = this._ev[n]; if (l)
        this._ev[n] = l.filter(x => x !== f && x._orig !== f); return this; }
    removeListener(n, f) { return this.off(n, f); }
    removeAllListeners(n) { if (n === undefined)
        this._ev = Object.create(null);
    else
        delete this._ev[n]; return this; }
    emit(n, ...a) { const l = this._ev[n]; if (!l || !l.length)
        return false; for (const f of l.slice())
        f.apply(this, a); return true; }
    listenerCount(n) { return (this._ev[n] || []).length; }
    listeners(n) { return (this._ev[n] || []).slice(); }
    setMaxListeners() { return this; }
}
export default EventEmitter;
export { EventEmitter };
