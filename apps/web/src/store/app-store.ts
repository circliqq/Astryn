import { create } from "zustand";

interface AppState {
  network: "Base" | "Ethereum";
  setNetwork: (network: "Base" | "Ethereum") => void;
}

export const useAppStore = create<AppState>((set) => ({
  network: "Base",
  setNetwork: (network) => set({ network })
}));
