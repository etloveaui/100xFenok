import PlaybookPost from "./PlaybookPost";
import type { NativePostId } from "@/lib/server/posts";
import "@/styles/native-post.css";

export default function NativePost({ id }: { id: NativePostId }) {
  return <article className="native-post" data-native-post={id}>
    {id === "playbook" && <PlaybookPost />}
  </article>;
}
