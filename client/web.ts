import { Platform } from "react-native";

/**
 * The only file that touches what a browser has and a phone does not. Each
 * export says what it needs of a node and nothing more, does its work on the
 * web and nothing anywhere else.
 */
export const ON_WEB = Platform.OS === "web";

/** What `slideTo` needs of the node behind a View's ref on the web. */
interface Slidable {
  style: { transform: string };
}

/**
 * Slides a mounted view sideways by a share of its own width, written straight
 * onto its node: no state changes, nothing is rendered again. The view's own
 * style must not set a transform, or the next render would put that back.
 */
export function slideTo(node: unknown, percent: number): void {
  if (!ON_WEB || node === null || typeof node !== "object" || !("style" in node)) return;
  (node as Slidable).style.transform = `translateX(${percent}%)`;
}
