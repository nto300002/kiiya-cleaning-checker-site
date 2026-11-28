import { signOutPath, requireAuthenticatedUser } from "./chatgpt-auth";
import CleaningApp from "./cleaning-app";
export const dynamic = "force-dynamic";
export default async function Home() {
  await requireAuthenticatedUser("/");
  return <CleaningApp signOutPath={signOutPath()} />;
}
