// SymbolDedupQueue.js
/**
 * Coda FIFO che mantiene un solo messaggio per symbol.
 * - Se arriva un nuovo messaggio per un symbol già in coda → sovrascrive il precedente.
 * - shift() restituisce sempre l’ultimo messaggio disponibile per ogni symbol.
 */
class SymbolDedupQueue {
  constructor() {
    this.map = new Map();     // symbol -> lastMsg
    this.queue = [];          // FIFO di symbol
    this.inQueue = new Set(); // simboli già accodati
  }

  push(msg) {
    const sym = msg.S;
    this.map.set(sym, msg);          // tieni sempre l’ultimo
    if (!this.inQueue.has(sym)) {    // aggiungi in coda solo se non presente
      this.queue.push(sym);
      this.inQueue.add(sym);
    }
  }

  shift() {
    const sym = this.queue.shift();
    if (sym === undefined) return undefined;
    this.inQueue.delete(sym);
    const msg = this.map.get(sym);   // prendi l’ultimo per quel symbol
    this.map.delete(sym);
    return msg;
  }

  get length() {
    return this.queue.length;
  }
}

module.exports = SymbolDedupQueue;
