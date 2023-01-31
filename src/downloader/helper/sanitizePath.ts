export const sanitizePath = (s: string) => s.replace(/[/\\?%*:|"<>]/g, '_');
