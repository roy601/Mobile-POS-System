"use client"

import Link from "next/link"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2, KeyRound } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { createClient } from "@/utils/supabase/component"
import { getURL } from "@/lib/utils/get-url"
import { forgotPasswordSchema, type ForgotPasswordFormValues } from "@/lib/validations/auth"

export default function ForgotPasswordPage() {
  const supabase = createClient()
  const [sent, setSent] = useState(false)

  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  })

  async function onSubmit(values: ForgotPasswordFormValues) {
    await supabase.auth.resetPasswordForEmail(values.email, {
      redirectTo: `${getURL()}auth/confirm?type=recovery&next=/reset-password`,
    })

    // Always show the same success state, whether or not the account
    // exists, to avoid leaking which emails are registered.
    setSent(true)
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <KeyRound className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">Reset your password</CardTitle>
          <CardDescription>We&apos;ll email you a link to set a new password</CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <p className="text-sm text-muted-foreground text-center">
              If an account exists for that email, a reset link has been sent. Check your inbox.
            </p>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email address</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="you@store.com" autoComplete="email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Send reset link
                </Button>
              </form>
            </Form>
          )}

          <p className="text-sm text-muted-foreground text-center mt-6">
            <Link href="/login" className="text-primary font-medium hover:underline">
              Back to log in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
