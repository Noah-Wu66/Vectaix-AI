import crypto from 'crypto';

const PREFIX = 'enc:v1:';
const KEY_ENV = 'DATA_ENCRYPTION_KEY_B64';
let cachedKey = null;

function getKey() {
  if (cachedKey) return cachedKey;
  const keyB64 = process.env[KEY_ENV];
  if (!keyB64) {
    throw new Error(`${KEY_ENV} is not set`);
  }
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) {
    throw new Error(`${KEY_ENV} must be 32 bytes in base64`);
  }
  cachedKey = key;
  return key;
}

export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function encryptString(value) {
  if (typeof value !== 'string') return value;
  if (isEncrypted(value)) return value;
  const iv = crypto.randomBytes(12);
  const key = getKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, ciphertext]).toString('base64');
  return `${PREFIX}${payload}`;
}

export function decryptString(value) {
  if (typeof value !== 'string') return value;
  if (!isEncrypted(value)) {
    throw new Error('Expected encrypted string');
  }
  const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
  if (raw.length < 28) {
    throw new Error('Encrypted payload invalid');
  }
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const key = getKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return plaintext;
}

function mapPart(part, mapper) {
  if (!part || typeof part !== 'object') return part;
  const out = { ...part };
  if (typeof out.text === 'string') out.text = mapper(out.text);
  return out;
}

export function encryptMessage(message) {
  if (!message || typeof message !== 'object') return message;
  const out = { ...message };
  if (typeof out.content === 'string') out.content = encryptString(out.content);
  if (typeof out.thought === 'string') out.thought = encryptString(out.thought);
  if (Array.isArray(out.parts)) {
    out.parts = out.parts.map((part) => mapPart(part, encryptString));
  }
  return out;
}

export function decryptMessage(message) {
  if (!message || typeof message !== 'object') return message;
  const out = { ...message };
  if (typeof out.content === 'string') out.content = decryptString(out.content);
  if (typeof out.thought === 'string') out.thought = decryptString(out.thought);
  if (Array.isArray(out.parts)) {
    out.parts = out.parts.map((part) => mapPart(part, decryptString));
  }
  return out;
}

export function encryptMessages(messages) {
  if (!Array.isArray(messages)) return messages;
  return messages.map(encryptMessage);
}

export function decryptMessages(messages) {
  if (!Array.isArray(messages)) return messages;
  return messages.map(decryptMessage);
}

export function encryptConversation(conversation) {
  if (!conversation || typeof conversation !== 'object') return conversation;
  const out = { ...conversation };
  if (typeof out.title === 'string') out.title = encryptString(out.title);
  if (Array.isArray(out.messages)) out.messages = encryptMessages(out.messages);
  return out;
}

export function decryptConversation(conversation) {
  if (!conversation || typeof conversation !== 'object') return conversation;
  const out = { ...conversation };
  if (typeof out.title === 'string') out.title = decryptString(out.title);
  if (Array.isArray(out.messages)) out.messages = decryptMessages(out.messages);
  return out;
}

export function encryptSystemPrompts(prompts) {
  if (!Array.isArray(prompts)) return prompts;
  return prompts.map((p) => {
    if (!p || typeof p !== 'object') return p;
    const out = { ...p };
    if (typeof out.content === 'string') out.content = encryptString(out.content);
    return out;
  });
}

export function decryptSystemPrompts(prompts) {
  if (!Array.isArray(prompts)) return prompts;
  return prompts.map((p) => {
    if (!p || typeof p !== 'object') return p;
    const out = { ...p };
    if (typeof out.content === 'string') {
      out.content = isEncrypted(out.content) ? decryptString(out.content) : out.content;
    }
    return out;
  });
}

export function encryptSettings(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  const out = { ...settings };
  if (Array.isArray(out.systemPrompts)) {
    out.systemPrompts = encryptSystemPrompts(out.systemPrompts);
  }
  return out;
}

export function decryptSettings(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  const out = { ...settings };
  if (Array.isArray(out.systemPrompts)) {
    out.systemPrompts = decryptSystemPrompts(out.systemPrompts);
  }
  return out;
}
