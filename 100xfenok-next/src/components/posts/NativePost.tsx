import TariffPost from "./TariffPost";
import RmdPost from "./RmdPost";
import StablecoinPost from "./StablecoinPost";
import PlaybookPost from "./PlaybookPost";
import type { NativePostId } from "@/lib/server/posts";
import "@/styles/native-post.css";

export default function NativePost({ id }: { id: NativePostId }) {
  return <article className="native-post" data-native-post={id}>
    {id === "tariff" && <TariffPost />}
    {id === "rmd" && <RmdPost />}
    {id === "stablecoin" && <StablecoinPost />}
    {id === "playbook" && <PlaybookPost />}
  </article>;
}
