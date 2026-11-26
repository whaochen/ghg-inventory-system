import worker, { Env } from '../../src/worker/index.js';

/**
 * Cloudflare Pages Functions 轉接層：將所有 /api/* 請求轉發至 Worker 入口
 */
export const onRequest = async (context: {
  request: Request;
  env: Env;
}): Promise<Response> => {
  return worker.fetch(context.request, context.env);
};
