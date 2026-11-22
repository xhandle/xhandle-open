export const isReportRaster = value => typeof value === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+={0,2}$/i.test(value);

export function normalizeReportImages(value) {
  return isReportRaster(value?.light) && isReportRaster(value?.dark)
    ? { light: value.light, dark: value.dark } : null;
}
