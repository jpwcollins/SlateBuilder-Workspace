import { redirect } from "next/navigation";

// SlateBuilder Pro is offline; its guide goes to the notice. See ../page.tsx.
export default function ProGuideOffline() {
  redirect("/");
}
