export const MOTION_EASE = [0.22, 1, 0.36, 1] as const;

export function revealMotion(delay = 0, distance = 24) {
  return {
    initial: { opacity: 0, y: distance, filter: "blur(10px)" },
    whileInView: { opacity: 1, y: 0, filter: "blur(0px)" },
    viewport: { once: true, amount: 0.18 },
    transition: {
      duration: 0.62,
      delay,
      ease: MOTION_EASE,
    },
  };
}

export const cardHoverMotion = {} as const;

export const actionHoverMotion = {} as const;
