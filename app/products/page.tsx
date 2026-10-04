import type { Metadata } from "next";
import { Plus, Save, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MainNav } from "@/components/main-nav";
import { UserNav } from "@/components/user-nav";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export const metadata: Metadata = {
  title: "Product Management",
  description: "Add and manage products for mobile selling shop",
};

export default function ProductsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="sticky top-0 z-40">
        <div className="flex h-16 items-center gap-3 px-4">
          {/* The nav takes whatever is left and shrinks into it. The
              old three-column grid gave it its natural width and let it
              overflow, so on a narrower monitor the last destinations
              were simply cut off the end. */}
          <MainNav className="min-w-0 flex-1" />
          <div className="flex shrink-0 items-center space-x-4">
            <UserNav />
          </div>
        </div>
      </div>

      <div className="flex-1 p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Product Management</h1>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add New Product
          </Button>
        </div>

        <Tabs defaultValue="add-product">
          <TabsList className="grid w-full grid-cols-3 max-w-md">
            <TabsTrigger value="add-product">Add Product</TabsTrigger>
            <TabsTrigger value="product-list">Product List</TabsTrigger>
            <TabsTrigger value="categories">Categories</TabsTrigger>
          </TabsList>

          <TabsContent value="add-product" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Add New Product</CardTitle>
                <CardDescription>
                  Enter the product details to add to inventory
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-6">
                  {/* Basic Information */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium">Basic Information</h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="product-name">Product Name*</Label>
                        <Input
                          id="product-name"
                          placeholder="Enter product name"
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor="model">Model Number*</Label>
                        <Input
                          id="model"
                          placeholder="Enter model number"
                          required
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="barcode">Barcode</Label>
                        <Input
                          id="barcode"
                          placeholder="Enter or scan barcode"
                        />
                      </div>
                      <div>
                        <Label htmlFor="sku">SKU</Label>
                        <Input id="sku" placeholder="Enter SKU" />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="category">Category*</Label>
                        <Select>
                          <SelectTrigger id="category">
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="phones">Phones</SelectItem>
                            <SelectItem value="tablets">Tablets</SelectItem>
                            <SelectItem value="accessories">
                              Accessories
                            </SelectItem>
                            <SelectItem value="cases">
                              Cases & Covers
                            </SelectItem>
                            <SelectItem value="chargers">
                              Chargers & Cables
                            </SelectItem>
                            <SelectItem value="headphones">
                              Headphones
                            </SelectItem>
                            <SelectItem value="speakers">Speakers</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="brand">Brand*</Label>
                        <Select>
                          <SelectTrigger id="brand">
                            <SelectValue placeholder="Select brand" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="apple">Apple</SelectItem>
                            <SelectItem value="samsung">Samsung</SelectItem>
                            <SelectItem value="xiaomi">Xiaomi</SelectItem>
                            <SelectItem value="oppo">Oppo</SelectItem>
                            <SelectItem value="vivo">Vivo</SelectItem>
                            <SelectItem value="oneplus">OnePlus</SelectItem>
                            <SelectItem value="google">Google</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  {/* Pricing & Inventory */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium">Pricing & Inventory</h3>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <Label htmlFor="cost-price">Cost Price*</Label>
                        <Input
                          id="cost-price"
                          type="number"
                          placeholder="0.00"
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor="selling-price">Selling Price*</Label>
                        <Input
                          id="selling-price"
                          type="number"
                          placeholder="0.00"
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor="mrp">MRP</Label>
                        <Input id="mrp" type="number" placeholder="0.00" />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <Label htmlFor="quantity">Quantity*</Label>
                        <Input
                          id="quantity"
                          type="number"
                          placeholder="0"
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor="low-stock">Low Stock Alert</Label>
                        <Input id="low-stock" type="number" placeholder="5" />
                      </div>
                      <div className="flex items-end space-x-2">
                        <div className="flex-1">
                          <Label htmlFor="tax">Tax (%)</Label>
                          <Input id="tax" type="number" placeholder="0" />
                        </div>
                        <div className="pb-2">
                          <Switch id="tax-inclusive" />
                          <Label htmlFor="tax-inclusive" className="ml-2">
                            Tax Inclusive
                          </Label>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Specifications */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium">Specifications</h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="color">Available Colors</Label>
                        <Select>
                          <SelectTrigger id="color">
                            <SelectValue placeholder="Select colors" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="black">Black</SelectItem>
                            <SelectItem value="white">White</SelectItem>
                            <SelectItem value="silver">Silver</SelectItem>
                            <SelectItem value="gold">Gold</SelectItem>
                            <SelectItem value="blue">Blue</SelectItem>
                            <SelectItem value="red">Red</SelectItem>
                            <SelectItem value="green">Green</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="storage">Storage Capacity</Label>
                        <Select>
                          <SelectTrigger id="storage">
                            <SelectValue placeholder="Select storage" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="16gb">16GB</SelectItem>
                            <SelectItem value="32gb">32GB</SelectItem>
                            <SelectItem value="64gb">64GB</SelectItem>
                            <SelectItem value="128gb">128GB</SelectItem>
                            <SelectItem value="256gb">256GB</SelectItem>
                            <SelectItem value="512gb">512GB</SelectItem>
                            <SelectItem value="1tb">1TB</SelectItem>
                            <SelectItem value="na">N/A</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="description">Description</Label>
                      <Textarea
                        id="description"
                        placeholder="Enter product description"
                        className="h-24"
                      />
                    </div>
                  </div>

                  {/* Product Image */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium">Product Image</h3>

                    <div className="border-2 border-dashed rounded-lg p-6 text-center">
                      <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground mb-2">
                        Drag and drop image here or click to browse
                      </p>
                      <Button variant="outline" size="sm">
                        Upload Image
                      </Button>
                    </div>
                  </div>

                  {/* Additional Information */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium">
                      Additional Information
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="warranty">Warranty Period</Label>
                        <Select>
                          <SelectTrigger id="warranty">
                            <SelectValue placeholder="Select warranty period" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No Warranty</SelectItem>
                            <SelectItem value="3months">3 Months</SelectItem>
                            <SelectItem value="6months">6 Months</SelectItem>
                            <SelectItem value="1year">1 Year</SelectItem>
                            <SelectItem value="2years">2 Years</SelectItem>
                            <SelectItem value="3years">3 Years</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="supplier">Supplier</Label>
                        <Select>
                          <SelectTrigger id="supplier">
                            <SelectValue placeholder="Select supplier" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="techsupplies">
                              TechSupplies Inc.
                            </SelectItem>
                            <SelectItem value="accessoryworld">
                              AccessoryWorld
                            </SelectItem>
                            <SelectItem value="mobileparts">
                              MobileParts Ltd.
                            </SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Switch id="active" defaultChecked />
                      <Label htmlFor="active">
                        Product is active and available for sale
                      </Label>
                    </div>
                  </div>

                  {/* Form Actions */}
                  <div className="flex justify-end space-x-2 pt-4">
                    <Button variant="outline">
                      <X className="mr-2 h-4 w-4" />
                      Cancel
                    </Button>
                    <Button>
                      <Save className="mr-2 h-4 w-4" />
                      Save Product
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="product-list" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Product List</CardTitle>
                <CardDescription>Manage your existing products</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-center py-8 text-muted-foreground">
                  Product list will be displayed here. You can search, filter,
                  and manage your products.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="categories" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Categories</CardTitle>
                <CardDescription>Manage product categories</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-center py-8 text-muted-foreground">
                  Category management interface will be displayed here.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
