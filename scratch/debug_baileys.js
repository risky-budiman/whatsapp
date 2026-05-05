const Baileys = require('@whiskeysockets/baileys');
console.log('Baileys keys:', Object.keys(Baileys));
if (Baileys.default) {
  console.log('Baileys.default keys:', Object.keys(Baileys.default));
}
console.log('makeInMemoryStore:', Baileys.makeInMemoryStore);
console.log('Baileys.default.makeInMemoryStore:', Baileys.default?.makeInMemoryStore);
