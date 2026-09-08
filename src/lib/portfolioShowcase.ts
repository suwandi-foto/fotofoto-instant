/**
 * Static config for the "more of our work" browsing strip on the
 * feedback screen. No CMS in this pass — per the approved scope, a
 * small in-code array is enough; revisit only if a real portfolio
 * system is requested.
 */
export type PortfolioShowcaseItem = {
  id: string;
  title: string;
  tag: string;
  gradient: string;
};

export const PORTFOLIO_SHOWCASE: PortfolioShowcaseItem[] = [
  { id: "p1", title: "PT Krakatau Manufaktur", tag: "Steel & Heavy Industry", gradient: "linear-gradient(160deg, #2b2620, #131315)" },
  { id: "p2", title: "Sumber Baja Industri", tag: "Metal Components", gradient: "linear-gradient(160deg, #1f2b26, #131315)" },
  { id: "p3", title: "Nusantara Precision Parts", tag: "Automotive Supply", gradient: "linear-gradient(160deg, #26221f, #131315)" },
  { id: "p4", title: "Java Chemical Works", tag: "Process Manufacturing", gradient: "linear-gradient(160deg, #201f2b, #131315)" },
];
