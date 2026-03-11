import UserSettings from "@/models/UserSettings";

const MAX_PROMPT_NAME_LENGTH = 50;
const MAX_PROMPT_CONTENT_LENGTH = 10000;

function validatePromptFields({ name, content }, { requirePromptId = false, promptId } = {}) {
  if (requirePromptId && !promptId) {
    throw new Error("promptId, name and content are required");
  }
  if (!name || !content) {
    throw new Error("Name and content are required");
  }
  if (typeof name !== "string" || name.length > MAX_PROMPT_NAME_LENGTH) {
    throw new Error(`Name must be a string and cannot exceed ${MAX_PROMPT_NAME_LENGTH} characters`);
  }
  if (typeof content !== "string" || content.length > MAX_PROMPT_CONTENT_LENGTH) {
    throw new Error(`Content must be a string and cannot exceed ${MAX_PROMPT_CONTENT_LENGTH} characters`);
  }
}

export async function getUserSettings(userId) {
  const settings = await UserSettings.findOne({ userId });
  if (!settings) {
    return {
      systemPrompts: [],
      avatar: null,
    };
  }
  return settings.toObject();
}

async function ensureSettingsDocument(userId) {
  let settings = await UserSettings.findOne({ userId });
  if (!settings) {
    settings = await UserSettings.create({
      userId,
      systemPrompts: [],
      avatar: null,
    });
  }
  return settings;
}

export async function addUserPrompt(userId, { name, content }) {
  validatePromptFields({ name, content });
  const settings = await ensureSettingsDocument(userId);
  const nextPrompts = Array.isArray(settings.systemPrompts)
    ? [...settings.systemPrompts, { name, content }]
    : [{ name, content }];
  settings.systemPrompts = nextPrompts;
  settings.updatedAt = Date.now();
  await settings.save();
  return settings.toObject();
}

export async function deleteUserPrompt(userId, promptId) {
  const settings = await UserSettings.findOne({ userId });
  if (!settings) throw new Error("Settings not found");

  const targetPrompt = settings.systemPrompts.find((prompt) => prompt._id.toString() === promptId);
  if (!targetPrompt) throw new Error("Prompt not found");

  settings.systemPrompts = settings.systemPrompts.filter((prompt) => prompt._id.toString() !== promptId);
  settings.updatedAt = Date.now();
  await settings.save();
  return settings.toObject();
}

export async function updateUserAvatar(userId, avatar) {
  if (avatar !== null && avatar !== undefined && typeof avatar !== "string") {
    throw new Error("avatar must be a string or null");
  }
  const settings = await ensureSettingsDocument(userId);
  settings.avatar = avatar;
  settings.updatedAt = Date.now();
  await settings.save();
  return settings.toObject();
}

export async function updateUserPrompt(userId, { promptId, name, content }) {
  validatePromptFields({ name, content }, { requirePromptId: true, promptId });
  const settings = await UserSettings.findOne({ userId });
  if (!settings) throw new Error("Settings not found");

  const prompt = settings.systemPrompts?.id?.(promptId);
  if (!prompt) throw new Error("Prompt not found");

  prompt.name = String(name);
  prompt.content = String(content);
  settings.updatedAt = Date.now();
  await settings.save();
  return settings.toObject();
}
