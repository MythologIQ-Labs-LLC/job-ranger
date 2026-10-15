import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type ThemeName = "atelier" | "midnight" | "canopy";

interface ThemeDefinition {
  id: ThemeName;
  label: string;
  story: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    canvas: string;
    canvasGlow: string;
    sidebar: string;
    panel: string;
    panelMuted: string;
    panelStrong: string;
    border: string;
    borderStrong: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    textInverse: string;
    success: string;
    warning: string;
    danger: string;
    info: string;
    shadow: string;
  };
  fonts: {
    display: string;
    body: string;
    mono: string;
  };
}

export const THEMES: Record<ThemeName, ThemeDefinition> = {
  atelier: {
    id: "atelier",
    label: "Atelier",
    story: "Warm ivory, Job Ranger navy, and trail-green teal drawn from the official mountain emblem.",
    colors: {
      // 60/30/10: warm ivory surfaces, logo navy structure, accessible trail-green actions.
      // Semantic warnings/dangers retain their independent meaning.
      primary: "#00765f",
      secondary: "#17384d",
      accent: "#01896a",
      canvas: "#f6f3eb",
      canvasGlow: "rgba(1, 137, 106, 0.12)",
      sidebar: "#00182e",
      panel: "rgba(252, 251, 246, 0.94)",
      panelMuted: "rgba(241, 246, 242, 0.88)",
      panelStrong: "rgba(255, 255, 253, 0.99)",
      border: "rgba(46, 75, 88, 0.16)",
      borderStrong: "rgba(46, 75, 88, 0.30)",
      textPrimary: "#00182e",
      textSecondary: "#405867",
      textMuted: "#526c78",
      textInverse: "#f9faf7",
      success: "#126d61",
      warning: "#a35a0a",
      danger: "#b42335",
      info: "#086b70",
      shadow: "rgba(25, 48, 67, 0.12)",
    },
    fonts: {
      display: "\"Fraunces\", \"Georgia\", serif",
      body: "\"Manrope\", \"Segoe UI\", sans-serif",
      mono: "\"JetBrains Mono\", \"Consolas\", monospace",
    },
  },
  midnight: {
    id: "midnight",
    label: "Midnight",
    story: "Low-glare contrast for late-night triage, focus sessions, and deep review loops.",
    colors: {
      primary: "#38bdf8",
      secondary: "#0f172a",
      accent: "#f97316",
      canvas: "#07111f",
      canvasGlow: "rgba(56, 189, 248, 0.22)",
      sidebar: "#040a12",
      panel: "rgba(11, 24, 40, 0.82)",
      panelMuted: "rgba(12, 30, 48, 0.72)",
      panelStrong: "rgba(18, 37, 58, 0.95)",
      border: "rgba(125, 211, 252, 0.16)",
      borderStrong: "rgba(125, 211, 252, 0.3)",
      textPrimary: "#eff6ff",
      textSecondary: "#bfdbfe",
      textMuted: "#7dd3fc",
      textInverse: "#04111d",
      success: "#2dd4bf",
      warning: "#f97316",
      danger: "#fb7185",
      info: "#38bdf8",
      shadow: "rgba(2, 12, 27, 0.55)",
    },
    fonts: {
      display: "\"Space Grotesk\", \"Segoe UI\", sans-serif",
      body: "\"Manrope\", \"Segoe UI\", sans-serif",
      mono: "\"JetBrains Mono\", \"Consolas\", monospace",
    },
  },
  canopy: {
    id: "canopy",
    label: "Canopy",
    story: "A calm, green workspace for long sessions tuning filters and maintaining signal quality.",
    colors: {
      primary: "#166534",
      secondary: "#14532d",
      accent: "#65a30d",
      canvas: "#edf5ef",
      canvasGlow: "rgba(101, 163, 13, 0.2)",
      sidebar: "#11251b",
      panel: "rgba(247, 252, 247, 0.92)",
      panelMuted: "rgba(234, 245, 234, 0.82)",
      panelStrong: "rgba(255, 255, 255, 0.98)",
      border: "rgba(22, 101, 52, 0.18)",
      borderStrong: "rgba(22, 101, 52, 0.3)",
      textPrimary: "#132117",
      textSecondary: "#31533b",
      textMuted: "#557465",
      textInverse: "#f6fff8",
      success: "#15803d",
      warning: "#ca8a04",
      danger: "#dc2626",
      info: "#0f766e",
      shadow: "rgba(20, 83, 45, 0.12)",
    },
    fonts: {
      display: "\"Fraunces\", \"Georgia\", serif",
      body: "\"Manrope\", \"Segoe UI\", sans-serif",
      mono: "\"JetBrains Mono\", \"Consolas\", monospace",
    },
  },
};

interface ThemeState {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  themeDefinition: ThemeDefinition;
  themes: ThemeDefinition[];
}

const ThemeContext = createContext<ThemeState | undefined>(undefined);

function normalizeStoredTheme(value: string | null): ThemeName {
  if (value === "light") {
    return "atelier";
  }

  if (value === "dark") {
    return "midnight";
  }

  if (value === "atelier" || value === "midnight" || value === "canopy") {
    return value;
  }

  return "atelier";
}

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<ThemeName>("atelier");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const savedTheme = normalizeStoredTheme(localStorage.getItem("theme"));
    setTheme(savedTheme);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) {
      return;
    }

    const currentTheme = THEMES[theme];
    const root = document.documentElement;

    root.setAttribute("data-theme", theme);
    root.style.setProperty("--color-primary", currentTheme.colors.primary);
    root.style.setProperty("--color-secondary", currentTheme.colors.secondary);
    root.style.setProperty("--color-accent", currentTheme.colors.accent);
    root.style.setProperty("--color-canvas", currentTheme.colors.canvas);
    root.style.setProperty("--color-canvas-glow", currentTheme.colors.canvasGlow);
    root.style.setProperty("--color-sidebar", currentTheme.colors.sidebar);
    root.style.setProperty("--color-panel", currentTheme.colors.panel);
    root.style.setProperty("--color-panel-muted", currentTheme.colors.panelMuted);
    root.style.setProperty("--color-panel-strong", currentTheme.colors.panelStrong);
    root.style.setProperty("--color-border", currentTheme.colors.border);
    root.style.setProperty("--color-border-strong", currentTheme.colors.borderStrong);
    root.style.setProperty("--color-text-primary", currentTheme.colors.textPrimary);
    root.style.setProperty("--color-text-secondary", currentTheme.colors.textSecondary);
    root.style.setProperty("--color-text-muted", currentTheme.colors.textMuted);
    root.style.setProperty("--color-text-inverse", currentTheme.colors.textInverse);
    root.style.setProperty("--color-success", currentTheme.colors.success);
    root.style.setProperty("--color-warning", currentTheme.colors.warning);
    root.style.setProperty("--color-danger", currentTheme.colors.danger);
    root.style.setProperty("--color-info", currentTheme.colors.info);
    root.style.setProperty("--color-shadow", currentTheme.colors.shadow);
    root.style.setProperty("--font-display", currentTheme.fonts.display);
    root.style.setProperty("--font-body", currentTheme.fonts.body);
    root.style.setProperty("--font-mono", currentTheme.fonts.mono);

    localStorage.setItem("theme", theme);
  }, [theme, mounted]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        themeDefinition: THEMES[theme],
        themes: Object.values(THEMES),
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
