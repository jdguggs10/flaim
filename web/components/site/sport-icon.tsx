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

/** A decorative sport mark. Pair it with visible sport text or an accessible label. */
export function SportIcon({ sport, stroke = 1.5, ...props }: SportIconProps) {
  const Icon = SPORT_ICONS.get(sport.toLowerCase()) ?? IconTrophy;

  return <Icon {...props} aria-hidden="true" focusable="false" stroke={stroke} />;
}
