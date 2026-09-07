import {
  IconBallAmericanFootball,
  IconBallBaseball,
  IconBallBasketball,
  IconIceSkating,
  IconTrophy,
  type IconProps,
  type TablerIcon,
} from "@tabler/icons-react";

const SPORT_ICONS = new Map<string, TablerIcon>([
  ["football", IconBallAmericanFootball],
  ["baseball", IconBallBaseball],
  ["basketball", IconBallBasketball],
  ["hockey", IconIceSkating],
]);

type SportIconProps = IconProps & {
  sport: string;
};

/**
 * A sport mark, decorative by default. Pair it with visible sport text, or
 * pass `aria-label` and `role="img"` to override the default `aria-hidden`
 * when the icon carries the meaning on its own.
 */
export function SportIcon({ sport, stroke = 1.5, ...props }: SportIconProps) {
  const Icon = SPORT_ICONS.get(sport?.toLowerCase()) ?? IconTrophy;

  return <Icon aria-hidden="true" focusable="false" {...props} stroke={stroke} />;
}
