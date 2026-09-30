import "dotenv/config";
import mongoose from "mongoose";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Category, Product } from "./models.js";

if (!process.env.MONGODB_URI) {
  console.error("Set MONGODB_URI before seeding the Zariya catalog.");
  process.exitCode = 1;
} else {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { categories, products } = JSON.parse(
    await readFile(path.join(root, "shared", "catalog.json"), "utf8")
  );
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    await Category.bulkWrite(categories.map(({ id, ...category }) => ({
      updateOne: {
        filter: { _id: id },
        update: { $set: category },
        upsert: true
      }
    })));
    await Product.bulkWrite(products.map(({ id, stockQuantity = 12, ...product }) => ({
      updateOne: {
        filter: { _id: id },
        update: {
          $set: {
            ...product,
            productType: product.productType ?? "simple",
            regularPrice: product.regularPrice ?? product.compareAt ?? product.price,
            salePrice: product.salePrice ?? (product.compareAt && product.price < product.compareAt ? product.price : null),
            gallery: product.gallery ?? [],
            attributes: product.attributes ?? [],
            variations: product.variations ?? [],
            groupedProductIds: product.groupedProductIds ?? [],
            stockStatus: product.stockStatus ?? (stockQuantity > 0 ? "instock" : "outofstock"),
            manageStock: product.manageStock ?? true,
            sku: product.sku ?? `ZR-${id.toUpperCase()}`
          },
          $setOnInsert: { stockQuantity, active: true }
        },
        upsert: true
      }
    })));
    console.info(`Seeded ${categories.length} categories and ${products.length} products.`);
  } catch (error) {
    console.error("Catalog seeding failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
