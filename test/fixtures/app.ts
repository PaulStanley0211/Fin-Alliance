import { test as base } from "@playwright/test";
import {
  ChartsPage,
  ChatPage,
  HeaderPage,
  HeatmapPage,
  PositionsPage,
  SectorWatchlistPage,
  TradeBarPage,
} from "../pages";

type AppFixtures = {
  header: HeaderPage;
  sectors: SectorWatchlistPage;
  tradeBar: TradeBarPage;
  positions: PositionsPage;
  heatmap: HeatmapPage;
  chat: ChatPage;
  charts: ChartsPage;
};

export const test = base.extend<AppFixtures>({
  header: async ({ page }, use) => {
    await use(new HeaderPage(page));
  },
  sectors: async ({ page }, use) => {
    await use(new SectorWatchlistPage(page));
  },
  tradeBar: async ({ page }, use) => {
    await use(new TradeBarPage(page));
  },
  positions: async ({ page }, use) => {
    await use(new PositionsPage(page));
  },
  heatmap: async ({ page }, use) => {
    await use(new HeatmapPage(page));
  },
  chat: async ({ page }, use) => {
    await use(new ChatPage(page));
  },
  charts: async ({ page }, use) => {
    await use(new ChartsPage(page));
  },
});

export { expect } from "@playwright/test";
