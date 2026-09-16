export async function readLimitedText(
  response: Response,
  maxBytes = 5 * 1024 * 1024
): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => undefined);
  }, 30_000);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (timedOut) throw new Error('Media playlist read timeout');
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > maxBytes)
        throw new Error('Media playlist exceeds the size limit');
      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}
