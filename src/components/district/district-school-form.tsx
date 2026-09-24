"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { AppForm, markFormClean, useAppForm } from "@/components/forms/app-form";
import { updateSchoolAsAdmin } from "@/lib/actions/school-management";
import {
  adminSchoolEditBasicSchema,
  adminSchoolEditFullSchema,
} from "@/lib/validators/school.schema";
import { toFormData } from "@/lib/forms/to-form-data";

type SchoolFormValues = {
  schoolId: string;
  name: string;
  address: string;
  region: string;
  division: string;
  district: string;
};

type PlacementField = "region" | "division" | "district";

const PLACEMENT_FIELDS: { name: PlacementField; label: string }[] = [
  { name: "region", label: "Region" },
  { name: "division", label: "Division" },
  { name: "district", label: "District" },
];

/**
 * A school's details as the district portal edits them.
 *
 * `canEditPlacement` is true only for the division office: `updateSchoolAsAdmin`
 * accepts region, division and district from a Super Admin alone, because the
 * district decides which district admin supervises the school.
 */
export function DistrictSchoolForm({
  school,
  canEditPlacement,
}: {
  school: {
    id: string;
    name: string;
    schoolIdCode: string;
    address: string | null;
    region: string | null;
    division: string | null;
    district: string | null;
  };
  canEditPlacement: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useAppForm<SchoolFormValues>({
    schema: canEditPlacement ? adminSchoolEditFullSchema : adminSchoolEditBasicSchema,
    defaultValues: {
      schoolId: school.id,
      name: school.name,
      address: school.address ?? "",
      region: school.region ?? "",
      division: school.division ?? "",
      district: school.district ?? "",
    },
  });

  return (
    <AppForm
      form={form}
      className="space-y-4"
      onSubmit={(values) => {
        const payload = canEditPlacement
          ? values
          : { schoolId: values.schoolId, name: values.name, address: values.address };
        startTransition(async () => {
          const res = await updateSchoolAsAdmin(toFormData(payload));
          if (!res.ok) {
            if (res.fieldErrors) {
              for (const [field, message] of Object.entries(res.fieldErrors)) {
                if (field in values) {
                  form.setError(field as keyof SchoolFormValues, { message });
                }
              }
            }
            toast.error(res.error);
            return;
          }
          markFormClean(form);
          toast.success("School details saved");
          router.refresh();
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="district-school-id">School ID</Label>
        <Input id="district-school-id" value={school.schoolIdCode} disabled readOnly />
        <p className="text-xs text-muted-foreground">The School ID cannot be changed.</p>
      </div>

      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel required>School name</FormLabel>
            <FormControl>
              <Input maxLength={200} disabled={pending} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="address"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Address</FormLabel>
            <FormControl>
              <Input maxLength={500} disabled={pending} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {canEditPlacement ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {PLACEMENT_FIELDS.map((placement) => (
            <FormField
              key={placement.name}
              control={form.control}
              name={placement.name}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{placement.label}</FormLabel>
                  <FormControl>
                    <Input maxLength={100} disabled={pending} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {PLACEMENT_FIELDS.map((placement) => (
              <div key={placement.name} className="space-y-2">
                <Label htmlFor={`district-school-${placement.name}`}>{placement.label}</Label>
                <Input
                  id={`district-school-${placement.name}`}
                  value={school[placement.name] ?? ""}
                  placeholder="—"
                  disabled
                  readOnly
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Set by the division office.</p>
        </div>
      )}

      <Button type="submit" className="w-full sm:w-auto" loading={pending} loadingText="Saving…">
        Save details
      </Button>
    </AppForm>
  );
}
