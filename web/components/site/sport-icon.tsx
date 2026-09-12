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
 * A sport mark. Decorative (aria-hidden) when paired with visible sport text;
 * passing `aria-label` makes it an accessible image instead.
 */
export function SportIcon({ sport, stroke = 1.5, ...props }: SportIconProps) {
  const Icon = SPORT_ICONS.get(sport?.toLowerCase()) ?? IconTrophy;
  const labeled = Boolean(props["aria-label"]);

  return (
    <Icon
      aria-hidden={labeled ? undefined : true}
      role={labeled ? "img" : undefined}
      focusable="false"
      {...props}
      stroke={stroke}
    />
  );
}
