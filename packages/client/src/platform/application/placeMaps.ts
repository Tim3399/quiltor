/** Storing the picture a place's level is drawn on. */
export interface StoredMapImage {
  /** The image's content digest, which is also how it is fetched back. */
  id: string;
  mime: string;
  width: number;
  height: number;
  byteSize: number;
}

export interface PlaceMapsGateway {
  /** Keep `content` and return what it turned out to be. */
  store(content: Blob): Promise<StoredMapImage>;
  /** Where the stored image can be shown from. */
  sourceUrl(imageId: string): string;
}
