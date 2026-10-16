import { NextRequest, NextResponse } from "next/server";

import { getSessionUser, saveProduct } from "../../../../lib/store";

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const token = request.cookies.get("ivans_session")?.value;
    const user = token ? await getSessionUser(token) : null;
    if (!user) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
    if (user.role === "cashier") {
      return NextResponse.json({ message: "You do not have permission to manage inventory." }, { status: 403 });
    }

    const id = Number((await context.params).id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ message: "Product id is invalid." }, { status: 400 });
    }
    const body = await request.json() as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const barcode = typeof body.barcode === "string" ? body.barcode.trim() : "";
    const category = typeof body.category === "string" ? body.category.trim() : "";
    const price = Number(body.price);
    if (
      (body.barcode !== undefined &&
        body.barcode !== null &&
        typeof body.barcode !== "string") ||
      !name ||
      name.length > 180 ||
      barcode.length > 64 ||
      !category ||
      category.length > 100 ||
      !Number.isFinite(price) ||
      price < 0
    ) {
      return NextResponse.json({ message: "Product details are invalid." }, { status: 400 });
    }
    const product = await saveProduct({ name, barcode: barcode || null, category, price }, id);
    if (!product) return NextResponse.json({ message: "Product not found." }, { status: 404 });
    return NextResponse.json({ product });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ER_DUP_ENTRY"
    ) {
      return NextResponse.json({ message: "That barcode is already assigned to another product." }, { status: 409 });
    }
    console.error("Unable to update product:", error);
    return NextResponse.json({ message: "Unable to update product." }, { status: 500 });
  }
}
