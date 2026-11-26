import { createAppServer } from './app.js';

const PORT = Number(process.env.PORT ?? 3088);
const { server } = createAppServer();

server.listen(PORT, '127.0.0.1', () => {
  console.log(`AI 溫室氣體盤查系統本機 Web 應用已啟動: http://127.0.0.1:${PORT}`);
  console.log('預設測試帳號 (僅供本機開發測試):');
  console.log('  管理者 (admin)    : admin / admin-password-123');
  console.log('  審核者 (reviewer) : reviewer / reviewer-password-123');
  console.log('  使用者 (user)     : user / user-password-123');
});
