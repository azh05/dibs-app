import { router, type Href } from 'expo-router';

/** Leave a pushed flow (sign-in, onboarding) for `href`. `dismissAll` throws "The action 'POP_TO_TOP' was not
 * handled" when nothing is pushed, e.g. when the tabs redirected straight to Pick a username, so only dismiss when
 * there's something to dismiss. */
export function resetTo(href: Href) {
  if (router.canDismiss()) router.dismissAll();
  router.replace(href);
}
