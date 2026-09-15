/**
 * 触发浏览器下载一个文本文件。
 *
 * 用 Blob + 临时 objectURL，不经过服务端 —— 日历文件本身不含敏感信息，
 * 没必要为此加一个接口。
 */
export function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  // 立刻 revoke 在部分浏览器上会打断下载，等一拍再释放
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
