import { GITHUB_REPOSITORY } from "./site";

export const RELEASES_URL = `https://github.com/${GITHUB_REPOSITORY}/releases`;

const API_URL = `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest`;
const CACHE_KEY = "aqqua-latest-release";

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface Release {
  tag_name: string;
  html_url: string;
  assets: ReleaseAsset[];
}

export async function fetchLatestRelease(): Promise<Release> {
  const cached = sessionStorage.getItem(CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const response = await fetch(API_URL);
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} for ${API_URL}`);
  }
  const data = await response.json();

  if (data?.assets) {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
  }

  return data;
}
