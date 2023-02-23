export const sanitizePath = (s: string) => s.trim().replace(/[/\\?%*:|"<>]/g, '_');
