import { chatGPTSignOutPath, requireChatGPTUser } from "./chatgpt-auth";
import CleaningApp from "./cleaning-app";
export const dynamic = "force-dynamic";
export default async function Home() {
  await requireChatGPTUser("/");
  return <CleaningApp signOutPath={chatGPTSignOutPath("/signed-out")} />;
}
