import { z } from "zod";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export const benchmarkPointSchema = z.object({
  date: z.string().regex(isoDate),
  px_last: z.number(),
  best_eps: z.number(),
  best_pe_ratio: z.number(),
  px_to_book_ratio: z.number(),
  roe: z.number(),
});

export const benchmarkSectionSchema = z.object({
  name: z.string(),
  name_en: z.string().optional(),
  data: z.array(benchmarkPointSchema),
});

export const benchmarkDatasetSchema = z.object({
  metadata: z
    .object({
      version: z.string(),
      source: z.string(),
      generated: z.string().optional(),
      sheet: z.string().optional(),
      update_frequency: z.string().optional(),
    })
    .passthrough(),
  sections: z.record(z.string(), benchmarkSectionSchema),
});

export const benchmarkSummarySchema = z
  .object({
    metadata: z
      .object({
        version: z.string(),
        source: z.string(),
        generated: z.string().optional(),
        type: z.string().optional(),
      })
      .passthrough(),
    momentum: z.record(
      z.string(),
      z
        .object({
          "1m": z.number().optional(),
          "3m": z.number().optional(),
          "6m": z.number().optional(),
          ytd: z.number().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export const benchmarkCatalogSchema = z
  .object({
    version: z.string(),
    updated: z.string(),
    source: z.string().optional(),
    files: z.record(
      z.string(),
      z
        .object({
          description: z.string().optional(),
          date_range: z.array(z.string()).optional(),
          records_per_index: z.number().optional(),
          sectors: z.array(z.string()).optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export const dataFolderManifestItemSchema = z
  .object({
    version: z.string(),
    updated: z.string(),
    update_frequency: z.string().optional(),
    source: z.string().optional(),
    file_count: z.number().optional(),
    schema: z.boolean().optional(),
    description: z.string().optional(),
  })
  .passthrough();

export const dataRootManifestSchema = z
  .object({
    manifest_version: z.string().optional(),
    created: z.string().optional(),
    last_updated: z.string().optional(),
    folders: z.record(z.string(), dataFolderManifestItemSchema),
  })
  .passthrough();

export const folderSchemaMetaSchema = z
  .object({
    folder: z.string().optional(),
    version: z.string().optional(),
    updated: z.string().optional(),
    source: z.string().optional(),
    update_frequency: z.string().optional(),
    files: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const sentimentEntrySchema = z.object({
  date: z.string().regex(isoDate),
});

export const sentimentSeriesSchema = z.array(sentimentEntrySchema.passthrough());

export type BenchmarkDataset = z.infer<typeof benchmarkDatasetSchema>;
export type BenchmarkSummary = z.infer<typeof benchmarkSummarySchema>;
export type BenchmarkCatalog = z.infer<typeof benchmarkCatalogSchema>;
export type SentimentSeries = z.infer<typeof sentimentSeriesSchema>;
export type DataRootManifest = z.infer<typeof dataRootManifestSchema>;
export type FolderSchemaMeta = z.infer<typeof folderSchemaMetaSchema>;
