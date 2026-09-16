declare module 'parse-torrent-name' {
  interface ParsedTorrent {
    title?: string;
    season?: number;
    episode?: number;
    year?: number;
    resolution?: string;
    codec?: string;
    audio?: string;
    group?: string;
    region?: string;
    extended?: boolean;
    hardcoded?: boolean;
    proper?: boolean;
    repack?: boolean;
    container?: string;
    widescreen?: boolean;
    website?: string;
    language?: string;
    sbs?: string;
    unrated?: boolean;
    size?: string;
    bitDepth?: string;
    hdr?: boolean;
    [key: string]: unknown;
  }

  function parseTorrentName(name: string): ParsedTorrent;
  export default parseTorrentName;
}
