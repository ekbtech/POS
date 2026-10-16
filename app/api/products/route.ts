import { NextRequest, NextResponse } from "next/server";

import { getBranchNames, getProducts, getSessionUser, saveProduct } from "../../../lib/store";

async function currentUser(request: NextRequest) {
  const token = request.cookies.get("ivans_session")?.value;
  return token ? getSessionUser(token) : null;
}

function validateProduct(body: Record<string, unknown>) {
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
    return null;
  }
  return { name, barcode: barcode || null, category, price };
}

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get("ivans_session")?.value;
    const user = token ? await getSessionUser(token) : null;
    if (!user) {
      return NextResponse.json({ message: "Sign in required." }, { status: 401 });
    }
    const branches = await getBranchNames();
    const requestedBranch = request.nextUrl.searchParams.get("branch");
    const branch = user.role === "admin" ? requestedBranch || branches[0] : user.branch;
    if (!branch || !branches.includes(branch)) {
      return NextResponse.json({ message: "Choose a valid branch." }, { status: 400 });
    }
    return NextResponse.json({ products: await getProducts(branch), branch });
  } catch (error) {
    console.error("Unable to load products:", error);
    return NextResponse.json({ message: "Unable to load products." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await currentUser(request);
    if (!user) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
    if (user.role === "cashier") {
      return NextResponse.json({ message: "You do not have permission to manage inventory." }, { status: 403 });
    }
    const product = validateProduct(await request.json());
    if (!product) return NextResponse.json({ message: "Product details are invalid." }, { status: 400 });
    return NextResponse.json({ product: await saveProduct(product) }, { status: 201 });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ER_DUP_ENTRY"
    ) {
      return NextResponse.json({ message: "That barcode is already assigned to another product." }, { status: 409 });
    }
    console.error("Unable to create product:", error);
    return NextResponse.json({ message: "Unable to create product." }, { status: 500 });
  }
}
