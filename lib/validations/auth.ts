import { z } from "zod"

export const emailSchema = z.string().trim().min(1, "Email is required").email("Enter a valid email address")

export const passwordSchema = z
  .string()
  .min(8, "At least 8 characters")
  .regex(/[A-Z]/, "Include at least one uppercase letter")
  .regex(/[0-9]/, "Include at least one number")

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
})
export type LoginFormValues = z.infer<typeof loginSchema>

export const signupSchema = z
  .object({
    fullName: z.string().trim().min(2, "Enter your full name"),
    phone: z.string().trim().min(7, "Enter a valid phone number").optional().or(z.literal("")),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
export type SignupFormValues = z.infer<typeof signupSchema>

export const forgotPasswordSchema = z.object({
  email: emailSchema,
})
export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>
