import { isApiAuthorized, unauthorized } from "../middlewares/auth.js";
import { runtime } from "../services/runtime.js";
import { json, parseBody } from "../utils/http.js";
import { getThreadType } from "../utils/thread.js";

export async function handleApiRoute(req, res, pathname, urlObj) {
  if (!pathname.startsWith("/v1/")) return false;

  if (!isApiAuthorized(req)) {
    unauthorized(res, "bearer");
    return true;
  }

  const apiClient = runtime.apiClient;
  if (!apiClient) {
    json(res, 503, { ok: false, message: "Zalo 未登录，请先扫码登录" });
    return true;
  }

  // 基础信息
  if (req.method === "GET" && pathname === "/v1/profile") return json(res, 200, { ok: true, data: await apiClient.fetchAccountInfo() }), true;
  if (req.method === "GET" && pathname === "/v1/friends") return json(res, 200, { ok: true, data: await apiClient.getAllFriends() }), true;
  if (req.method === "GET" && pathname === "/v1/groups") return json(res, 200, { ok: true, data: await apiClient.getAllGroups() }), true;

  // 用户
  if (req.method === "GET" && pathname.startsWith("/v1/users/") && pathname !== "/v1/users/search") {
    const userId = decodeURIComponent(pathname.replace("/v1/users/", "")).trim();
    if (!userId) return json(res, 400, { ok: false, message: "userId 不能为空" }), true;
    return json(res, 200, { ok: true, data: await apiClient.getUserInfo(userId) }), true;
  }

  if (req.method === "GET" && pathname === "/v1/users/search") {
    const phone = (urlObj.searchParams.get("phone") ?? "").trim();
    if (!phone) return json(res, 400, { ok: false, message: "phone 不能为空" }), true;
    return json(res, 200, { ok: true, data: await apiClient.findUser(phone) }), true;
  }

  // 好友关系
  if (req.method === "GET" && pathname === "/v1/friends/requests/sent") {
    return json(res, 200, { ok: true, data: await apiClient.getSentFriendRequest() }), true;
  }

  if (req.method === "GET" && pathname.startsWith("/v1/friends/requests/status/")) {
    const userId = decodeURIComponent(pathname.replace("/v1/friends/requests/status/", "")).trim();
    if (!userId) return json(res, 400, { ok: false, message: "userId 不能为空" }), true;
    return json(res, 200, { ok: true, data: await apiClient.getFriendRequestStatus(userId) }), true;
  }

  if (req.method === "POST" && pathname === "/v1/friends/requests") {
    const body = await parseBody(req);
    const userId = `${body.userId ?? ""}`.trim();
    const message = `${body.message ?? ""}`.trim() || "你好，很高兴认识你";
    if (!userId) return json(res, 400, { ok: false, message: "userId 不能为空" }), true;
    return json(res, 200, { ok: true, data: await apiClient.sendFriendRequest(message, userId) }), true;
  }

  if (req.method === "POST" && pathname.startsWith("/v1/friends/requests/") && pathname.endsWith("/accept")) {
    const userId = decodeURIComponent(pathname.replace("/v1/friends/requests/", "").replace("/accept", "")).trim();
    if (!userId) return json(res, 400, { ok: false, message: "userId 不能为空" }), true;
    return json(res, 200, { ok: true, data: await apiClient.acceptFriendRequest(userId) }), true;
  }

  if (req.method === "POST" && pathname.startsWith("/v1/friends/requests/") && pathname.endsWith("/reject")) {
    const userId = decodeURIComponent(pathname.replace("/v1/friends/requests/", "").replace("/reject", "")).trim();
    if (!userId) return json(res, 400, { ok: false, message: "userId 不能为空" }), true;
    return json(res, 200, { ok: true, data: await apiClient.rejectFriendRequest(userId) }), true;
  }

  if (req.method === "POST" && pathname.startsWith("/v1/friends/requests/") && pathname.endsWith("/undo")) {
    const userId = decodeURIComponent(pathname.replace("/v1/friends/requests/", "").replace("/undo", "")).trim();
    if (!userId) return json(res, 400, { ok: false, message: "userId 不能为空" }), true;
    return json(res, 200, { ok: true, data: await apiClient.undoFriendRequest(userId) }), true;
  }

  // 群组
  if (req.method === "GET" && pathname.startsWith("/v1/groups/")) {
    if (pathname.endsWith("/history")) {
      const groupId = decodeURIComponent(pathname.replace("/v1/groups/", "").replace("/history", "")).trim();
      const count = Number(urlObj.searchParams.get("count") ?? 20);
      if (!groupId) return json(res, 400, { ok: false, message: "groupId 不能为空" }), true;
      return json(res, 200, { ok: true, data: await apiClient.getGroupChatHistory(groupId, Number.isFinite(count) ? count : 20) }), true;
    }

    const groupId = decodeURIComponent(pathname.replace("/v1/groups/", "")).trim();
    if (!groupId) return json(res, 400, { ok: false, message: "groupId 不能为空" }), true;
    return json(res, 200, { ok: true, data: await apiClient.getGroupInfo(groupId) }), true;
  }

  if (req.method === "GET" && pathname.startsWith("/v1/group-members/")) {
    const memberId = decodeURIComponent(pathname.replace("/v1/group-members/", "")).trim();
    if (!memberId) return json(res, 400, { ok: false, message: "memberId 不能为空" }), true;
    return json(res, 200, { ok: true, data: await apiClient.getGroupMembersInfo(memberId) }), true;
  }

  if ((req.method === "POST" || req.method === "DELETE") && pathname.startsWith("/v1/groups/") && pathname.includes("/members/")) {
    const match = pathname.match(/^\/v1\/groups\/(.+?)\/members\/(.+)$/);
    if (!match) return false;

    const groupId = decodeURIComponent(match[1]).trim();
    const memberId = decodeURIComponent(match[2]).trim();
    if (!groupId || !memberId) return json(res, 400, { ok: false, message: "groupId/memberId 不能为空" }), true;

    if (req.method === "POST") {
      return json(res, 200, { ok: true, data: await apiClient.addUserToGroup(memberId, groupId) }), true;
    }

    return json(res, 200, { ok: true, data: await apiClient.removeUserFromGroup(memberId, groupId) }), true;
  }

  // 消息
  if (req.method === "POST" && pathname === "/v1/messages") {
    const body = await parseBody(req);
    const threadId = `${body.threadId ?? ""}`.trim();
    const threadType = getThreadType(body.threadType);
    const msg = `${body.msg ?? ""}`.trim();
    if (!threadId || !threadType || !msg) return json(res, 400, { ok: false, message: "参数不完整，必须提供 threadId、threadType(user/group)、msg" }), true;
    return json(res, 200, { ok: true, data: await apiClient.sendMessage({ msg }, threadId, threadType) }), true;
  }

  if (req.method === "POST" && pathname === "/v1/messages/typing") {
    const body = await parseBody(req);
    const threadId = `${body.threadId ?? ""}`.trim();
    const threadType = getThreadType(body.threadType);
    if (!threadId || !threadType) return json(res, 400, { ok: false, message: "threadId/threadType 不能为空" }), true;
    return json(res, 200, { ok: true, data: await apiClient.sendTypingEvent(threadId, threadType) }), true;
  }

  if (req.method === "POST" && pathname === "/v1/messages/forward") {
    const body = await parseBody(req);
    const message = `${body.message ?? ""}`.trim();
    const threadIds = Array.isArray(body.threadIds) ? body.threadIds.map((x) => `${x}`.trim()).filter(Boolean) : [];
    const threadType = getThreadType(body.threadType);
    if (!message || threadIds.length === 0 || !threadType) return json(res, 400, { ok: false, message: "message/threadIds/threadType 参数不完整" }), true;
    return json(res, 200, { ok: true, data: await apiClient.forwardMessage({ message }, threadIds, threadType) }), true;
  }

  if (req.method === "POST" && pathname === "/v1/messages/undo") {
    const body = await parseBody(req);
    const threadId = `${body.threadId ?? ""}`.trim();
    const threadType = getThreadType(body.threadType);
    const msgId = `${body.msgId ?? ""}`.trim();
    const cliMsgId = `${body.cliMsgId ?? ""}`.trim();
    if (!threadId || !threadType || !msgId || !cliMsgId) return json(res, 400, { ok: false, message: "threadId/threadType/msgId/cliMsgId 参数不完整" }), true;
    return json(res, 200, { ok: true, data: await apiClient.undo({ msgId, cliMsgId }, threadId, threadType) }), true;
  }

  if (req.method === "POST" && pathname === "/v1/messages/seen") {
    const body = await parseBody(req);
    const threadType = getThreadType(body.threadType);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!threadType || messages.length === 0) return json(res, 400, { ok: false, message: "threadType/messages 参数不完整" }), true;
    return json(res, 200, { ok: true, data: await apiClient.sendSeenEvent(messages, threadType) }), true;
  }

  return false;
}