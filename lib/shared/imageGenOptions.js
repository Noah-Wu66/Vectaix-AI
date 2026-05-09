export const IMAGE_GEN_SIZE_OPTIONS = Object.freeze([
  { value: "1:1", label: "1:1" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "3:2", label: "3:2" },
  { value: "2:3", label: "2:3" },
  { value: "5:4", label: "5:4" },
  { value: "4:5", label: "4:5" },
  { value: "2:1", label: "2:1" },
  { value: "1:2", label: "1:2" },
  { value: "21:9", label: "21:9" },
  { value: "9:21", label: "9:21" },
]);

export const IMAGE_GEN_RESOLUTION_OPTIONS = Object.freeze([
  { value: "1k", label: "1K" },
  { value: "2k", label: "2K" },
  { value: "4k", label: "4K" },
]);

export const IMAGE_GEN_SIZE_VALUES = Object.freeze(IMAGE_GEN_SIZE_OPTIONS.map((option) => option.value));
export const IMAGE_GEN_RESOLUTION_VALUES = Object.freeze(IMAGE_GEN_RESOLUTION_OPTIONS.map((option) => option.value));

export const IMAGE_GEN_SIZE_VALUES_BY_RESOLUTION = Object.freeze({
  "1k": IMAGE_GEN_SIZE_VALUES,
  "2k": IMAGE_GEN_SIZE_VALUES,
  "4k": Object.freeze(["16:9", "9:16", "2:1", "1:2", "21:9", "9:21"]),
});

export function getImageGenSizeOptionsForResolution(resolution) {
  const supportedValues = IMAGE_GEN_SIZE_VALUES_BY_RESOLUTION[resolution];
  if (!supportedValues) return [];
  return IMAGE_GEN_SIZE_OPTIONS.filter((option) => supportedValues.includes(option.value));
}

export function isImageGenSizeSupportedAtResolution(size, resolution) {
  const supportedValues = IMAGE_GEN_SIZE_VALUES_BY_RESOLUTION[resolution];
  return Boolean(supportedValues?.includes(size));
}
