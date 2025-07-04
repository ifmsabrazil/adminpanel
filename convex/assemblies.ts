import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

// Get all assemblies
export const getAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("assemblies")
      .withIndex("by_created_at")
      .order("desc")
      .collect();
  },
});

// Get active assemblies only
export const getActive = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("assemblies")
      .withIndex("by_status")
      .filter((q) => q.eq(q.field("status"), "active"))
      .order("desc")
      .collect();
  },
});

// Get next upcoming assembly
export const getNextUpcoming = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    
    // Get all active assemblies that haven't started yet
    const upcomingAssemblies = await ctx.db
      .query("assemblies")
      .withIndex("by_status")
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();
    
    // Filter to only future assemblies and sort by start date
    const futureAssemblies = upcomingAssemblies
      .filter(assembly => assembly.startDate > now)
      .sort((a, b) => a.startDate - b.startDate);
    
    // Return the earliest upcoming assembly
    return futureAssemblies.length > 0 ? futureAssemblies[0] : null;
  },
});

// Get assembly by ID
export const getById = query({
  args: { id: v.id("assemblies") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Create new assembly
export const create = mutation({
  args: {
    name: v.string(),
    type: v.string(), // "AG" | "AGE"
    location: v.string(),
    startDate: v.number(),
    endDate: v.number(),
    createdBy: v.string(),
    registrationOpen: v.optional(v.boolean()),
    registrationDeadline: v.optional(v.number()),
    maxParticipants: v.optional(v.number()),
    description: v.optional(v.string()),
    paymentRequired: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    // Set default payment requirement based on type
    const paymentRequired = args.paymentRequired ?? (args.type === "AG");
    
    return await ctx.db.insert("assemblies", {
      name: args.name,
      type: args.type,
      location: args.location,
      startDate: args.startDate,
      endDate: args.endDate,
      status: "active",
      createdAt: now,
      createdBy: args.createdBy,
      lastUpdated: now,
      lastUpdatedBy: args.createdBy,
      registrationOpen: args.registrationOpen ?? true,
      registrationDeadline: args.registrationDeadline,
      maxParticipants: args.maxParticipants,
      description: args.description,
      paymentRequired,
    });
  },
});

// Update assembly
export const update = mutation({
  args: {
    id: v.id("assemblies"),
    name: v.optional(v.string()),
    type: v.optional(v.string()),
    location: v.optional(v.string()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    lastUpdatedBy: v.string(),
    registrationOpen: v.optional(v.boolean()),
    registrationDeadline: v.optional(v.number()),
    maxParticipants: v.optional(v.number()),
    description: v.optional(v.string()),
    paymentRequired: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const assembly = await ctx.db.get(args.id);
    if (!assembly) {
      throw new Error("Assembly not found");
    }

    const updates: any = {
      lastUpdated: Date.now(),
      lastUpdatedBy: args.lastUpdatedBy,
    };

    // Add all optional fields that were provided
    if (args.name !== undefined) updates.name = args.name;
    if (args.type !== undefined) updates.type = args.type;
    if (args.location !== undefined) updates.location = args.location;
    if (args.startDate !== undefined) updates.startDate = args.startDate;
    if (args.endDate !== undefined) updates.endDate = args.endDate;
    if (args.registrationOpen !== undefined) updates.registrationOpen = args.registrationOpen;
    if (args.registrationDeadline !== undefined) updates.registrationDeadline = args.registrationDeadline;
    if (args.maxParticipants !== undefined) updates.maxParticipants = args.maxParticipants;
    if (args.description !== undefined) updates.description = args.description;
    if (args.paymentRequired !== undefined) updates.paymentRequired = args.paymentRequired;

    await ctx.db.patch(args.id, updates);
    return args.id;
  },
});

// Archive assembly
export const archive = mutation({
  args: {
    id: v.id("assemblies"),
    lastUpdatedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const assembly = await ctx.db.get(args.id);
    if (!assembly) {
      throw new Error("Assembly not found");
    }

    if (assembly.status !== "active") {
      throw new Error("Only active assemblies can be archived");
    }

    await ctx.db.patch(args.id, {
      status: "archived",
      lastUpdated: Date.now(),
      lastUpdatedBy: args.lastUpdatedBy,
      registrationOpen: false, // Close registration when archiving
    });

    return args.id;
  },
});

// Delete assembly and all related data
export const deleteWithRelatedData = mutation({
  args: {
    id: v.id("assemblies"),
    deletedBy: v.string(),
    confirmationText: v.string(),
  },
  handler: async (ctx, args) => {
    const assembly = await ctx.db.get(args.id);
    if (!assembly) {
      throw new Error("Assembly not found");
    }

    // Verify confirmation text
    if (args.confirmationText !== assembly.name) {
      throw new Error("Confirmation text does not match assembly name");
    }

    // Delete all registrations for this assembly
    const registrations = await ctx.db
      .query("agRegistrations")
      .withIndex("by_assembly")
      .filter((q) => q.eq(q.field("assemblyId"), args.id))
      .collect();

    // Delete payment receipts from file storage
    const registrationsWithReceipts = registrations.filter(r => r.receiptStorageId);
    for (const registration of registrationsWithReceipts) {
      try {
        // Delete the file from storage
        await ctx.storage.delete(registration.receiptStorageId as any);
      } catch (error) {
        // Continue even if file deletion fails (file might not exist)
        console.warn(`Failed to delete receipt file ${registration.receiptStorageId}:`, error);
      }
    }

    // Delete all registrations
    for (const registration of registrations) {
      await ctx.db.delete(registration._id);
    }

    // Delete all modalities for this assembly
    const modalities = await ctx.db
      .query("registrationModalities")
      .withIndex("by_assembly")
      .filter((q) => q.eq(q.field("assemblyId"), args.id))
      .collect();

    for (const modality of modalities) {
      await ctx.db.delete(modality._id);
    }

    // Delete all participants for this assembly (if any)
    const participants = await ctx.db
      .query("agParticipants")
      .withIndex("by_assembly")
      .filter((q) => q.eq(q.field("assemblyId"), args.id))
      .collect();

    for (const participant of participants) {
      await ctx.db.delete(participant._id);
    }

    // Delete all sessions and their attendance records for this assembly
    const sessions = await ctx.db
      .query("agSessions")
      .withIndex("by_assembly")
      .filter((q) => q.eq(q.field("assemblyId"), args.id))
      .collect();

    // Delete all attendance records for these sessions
    for (const session of sessions) {
      const attendanceRecords = await ctx.db
        .query("agSessionAttendance")
        .withIndex("by_session")
        .filter((q) => q.eq(q.field("sessionId"), session._id))
        .collect();

      for (const record of attendanceRecords) {
        await ctx.db.delete(record._id);
      }

      // Delete the session itself
      await ctx.db.delete(session._id);
    }

    // Finally, delete the assembly itself
    await ctx.db.delete(args.id);

    return {
      deletedAssembly: args.id,
      deletedRegistrations: registrations.length,
      deletedModalities: modalities.length,
      deletedParticipants: participants.length,
      deletedFiles: registrationsWithReceipts.length,
      deletedSessions: sessions.length,
      message: `Assembly "${assembly.name}" and all related data have been permanently deleted.`
    };
  },
});

// Bulk insert participants for a new AG
export const bulkInsertParticipants = mutation({
  args: {
    assemblyId: v.id("assemblies"),
    participants: v.array(v.object({
      type: v.string(),
      participantId: v.string(),
      name: v.string(),
      role: v.optional(v.string()),
      status: v.optional(v.string()),
      escola: v.optional(v.string()),
      regional: v.optional(v.string()),
      cidade: v.optional(v.string()),
      uf: v.optional(v.string()),
      agFiliacao: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    const insertPromises = args.participants.map(participant =>
      ctx.db.insert("agParticipants", {
        assemblyId: args.assemblyId,
        type: participant.type,
        participantId: participant.participantId,
        name: participant.name,
        role: participant.role,
        status: participant.status,
        createdAt: now,
        escola: participant.escola,
        regional: participant.regional,
        cidade: participant.cidade,
        uf: participant.uf,
        agFiliacao: participant.agFiliacao,
      })
    );

    const results = await Promise.all(insertPromises);
    return results.length;
  },
});

// Get participants for an assembly
export const getParticipants = query({
  args: { assemblyId: v.id("assemblies") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agParticipants")
      .withIndex("by_assembly")
      .filter((q) => q.eq(q.field("assemblyId"), args.assemblyId))
      .collect();
  },
});

// Get participants by type for an assembly
export const getParticipantsByType = query({
  args: { 
    assemblyId: v.id("assemblies"),
    type: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agParticipants")
      .withIndex("by_assembly_and_type")
      .filter((q) => 
        q.and(
          q.eq(q.field("assemblyId"), args.assemblyId),
          q.eq(q.field("type"), args.type)
        )
      )
      .collect();
  },
});

// Get registration statistics for an assembly
export const getRegistrationStats = query({
  args: { assemblyId: v.id("assemblies") },
  handler: async (ctx, args) => {
    const registrations = await ctx.db
      .query("agRegistrations")
      .withIndex("by_assembly")
      .filter((q) => q.eq(q.field("assemblyId"), args.assemblyId))
      .collect();

    const participants = await ctx.db
      .query("agParticipants")
      .withIndex("by_assembly")
      .filter((q) => q.eq(q.field("assemblyId"), args.assemblyId))
      .collect();

    const modalities = await ctx.db
      .query("registrationModalities")
      .withIndex("by_assembly")
      .filter((q) => q.eq(q.field("assemblyId"), args.assemblyId))
      .collect();

    const assembly = await ctx.db.get(args.assemblyId);

    const activeRegistrations = registrations.filter(r => 
      r.status !== "cancelled" && r.status !== "rejected"
    );

    const stats = {
      totalParticipants: participants.length,
      totalRegistrations: registrations.length,
      activeRegistrations: activeRegistrations.length,
      registrationsByType: {} as Record<string, number>,
      registrationsByStatus: {} as Record<string, number>,
      participantsByType: {} as Record<string, number>,
      modalityStats: [] as Array<{
        modalityId: string;
        name: string;
        price: number;
        maxParticipants?: number;
        currentRegistrations: number;
        isFull: boolean;
        isNearFull: boolean; // 90% capacity
      }>,
      assemblyCapacity: {
        maxParticipants: assembly?.maxParticipants,
        currentRegistrations: activeRegistrations.length,
        isFull: assembly?.maxParticipants ? activeRegistrations.length >= assembly.maxParticipants : false,
        isNearFull: assembly?.maxParticipants ? activeRegistrations.length >= (assembly.maxParticipants * 0.9) : false,
      },
    };

    // Count registrations by type and status
    registrations.forEach(reg => {
      stats.registrationsByType[reg.participantType] = (stats.registrationsByType[reg.participantType] || 0) + 1;
      stats.registrationsByStatus[reg.status] = (stats.registrationsByStatus[reg.status] || 0) + 1;
    });

    // Count participants by type
    participants.forEach(participant => {
      stats.participantsByType[participant.type] = (stats.participantsByType[participant.type] || 0) + 1;
    });

    // Calculate modality statistics
    for (const modality of modalities) {
      const modalityRegistrations = registrations.filter(r => 
        r.modalityId === modality._id && r.status !== "cancelled" && r.status !== "rejected"
      );

      const currentCount = modalityRegistrations.length;
      const isFull = modality.maxParticipants ? currentCount >= modality.maxParticipants : false;
      const isNearFull = modality.maxParticipants ? currentCount >= (modality.maxParticipants * 0.9) : false;

      stats.modalityStats.push({
        modalityId: modality._id,
        name: modality.name,
        price: modality.price,
        maxParticipants: modality.maxParticipants,
        currentRegistrations: currentCount,
        isFull,
        isNearFull,
      });
    }

    return stats;
  },
});

// Update payment required field for existing assemblies
export const updatePaymentRequired = mutation({
  args: {
    id: v.id("assemblies"),
    lastUpdatedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const assembly = await ctx.db.get(args.id);
    if (!assembly) {
      throw new Error("Assembly not found");
    }

    // Set paymentRequired based on type (AG = true, AGE = false)
    const paymentRequired = assembly.type === "AG";

    await ctx.db.patch(args.id, {
      paymentRequired,
      lastUpdated: Date.now(),
      lastUpdatedBy: args.lastUpdatedBy,
    });

    return args.id;
  },
});

// Get all data for assembly report
export const getAssemblyDataForReport = query({
  args: { id: v.id("assemblies") },
  handler: async (ctx, args) => {
    const assembly = await ctx.db.get(args.id);
    if (!assembly) {
      throw new Error("Assembly not found");
    }

    // Get all related data
    const participants = await ctx.db
      .query("agParticipants")
      .withIndex("by_assembly")
      .filter((q) => q.eq(q.field("assemblyId"), args.id))
      .collect();

    const registrations = await ctx.db
      .query("agRegistrations")
      .withIndex("by_assembly")
      .filter((q) => q.eq(q.field("assemblyId"), args.id))
      .collect();

    const modalities = await ctx.db
      .query("registrationModalities")
      .withIndex("by_assembly")
      .filter((q) => q.eq(q.field("assemblyId"), args.id))
      .collect();

    // Get AG config for reference
    const agConfig = await ctx.db
      .query("agConfigs")
      .withIndex("by_updated_at")
      .order("desc")
      .first();

    return {
      assembly,
      participants,
      registrations,
      modalities,
      agConfig,
    };
  },
});

// Get unique comitês locais from all agParticipants for registration dropdown
export const getComitesLocais = query({
  args: {},
  handler: async (ctx) => {
    const participants = await ctx.db
      .query("agParticipants")
      .filter((q) => q.eq(q.field("type"), "comite"))
      .collect();

    // Create a map to deduplicate committees by participantId
    const comiteMap = new Map();
    
    participants.forEach(participant => {
      if (participant.participantId && participant.participantId.trim()) {
        const key = participant.participantId.trim();
        if (!comiteMap.has(key)) {
          // Format as [ParticipantId] - [Escola]
          const displayName = participant.escola && participant.escola.trim() 
            ? `${participant.participantId.trim()} - ${participant.escola.trim()}`
            : participant.participantId.trim();
          
          comiteMap.set(key, {
            id: participant.participantId.trim(),
            name: displayName,
            participantId: participant.participantId.trim(),
            escola: participant.escola?.trim() || '',
            cidade: participant.cidade?.trim() || '',
            uf: participant.uf?.trim() || '',
            agFiliacao: participant.agFiliacao?.trim() || ''
          });
        }
      }
    });

    // Convert map to array, filter out valid entries, and sort by participantId
    return Array.from(comiteMap.values())
      .filter(comite => comite.participantId && comite.participantId.length > 0)
      .sort((a, b) => a.participantId.localeCompare(b.participantId, 'pt-BR', { sensitivity: 'base' }));
  },
});

// Get comitês locais with status for attendance management in plenárias
export const getComitesLocaisWithStatus = query({
  args: { assemblyId: v.optional(v.id("assemblies")) },
  handler: async (ctx, args) => {
    let participants;
    
    if (args.assemblyId) {
      // Get comités for specific assembly
      participants = await ctx.db
        .query("agParticipants")
        .withIndex("by_assembly_and_type")
        .filter((q) => 
          q.and(
            q.eq(q.field("assemblyId"), args.assemblyId),
            q.eq(q.field("type"), "comite")
          )
        )
        .collect();
    } else {
      // Get all comités (for backward compatibility)
      participants = await ctx.db
        .query("agParticipants")
        .filter((q) => q.eq(q.field("type"), "comite"))
        .collect();
    }

    // Create a map to deduplicate committees by participantId, keeping the status
    const comiteMap = new Map();
    
    participants.forEach(participant => {
      if (participant.participantId && participant.participantId.trim()) {
        const key = participant.participantId.trim();
        if (!comiteMap.has(key)) {
          // Format display name as [ParticipantId] - [Escola]
          const displayName = participant.escola && participant.escola.trim() 
            ? `${participant.participantId.trim()} - ${participant.escola.trim()}`
            : participant.participantId.trim();
          
          comiteMap.set(key, {
            id: participant.participantId.trim(),
            name: displayName,
            participantId: participant.participantId.trim(),
            escola: participant.escola?.trim() || '',
            cidade: participant.cidade?.trim() || '',
            uf: participant.uf?.trim() || '',
            agFiliacao: participant.agFiliacao?.trim() || '',
            status: participant.status || 'Não-pleno' // Include the status field!
          });
        }
      }
    });

    // Convert map to array, filter out valid entries, and sort by participantId
    return Array.from(comiteMap.values())
      .filter(comite => comite.participantId && comite.participantId.length > 0)
      .sort((a, b) => a.participantId.localeCompare(b.participantId, 'pt-BR', { sensitivity: 'base' }));
  },
});

// Get unique EBs from all agParticipants for registration dropdown
export const getEBs = query({
  args: {},
  handler: async (ctx) => {
    const participants = await ctx.db
      .query("agParticipants")
      .filter((q) => q.eq(q.field("type"), "eb"))
      .collect();

    // Create a map to deduplicate EBs by participantId
    const ebMap = new Map();
    
    participants.forEach(participant => {
      if (participant.participantId && participant.participantId.trim()) {
        const key = participant.participantId.trim();
        if (!ebMap.has(key)) {
          // Format as [Role] - [Name]
          const displayName = participant.role && participant.role.trim() 
            ? `${participant.role.trim()} - ${participant.name.trim()}`
            : participant.name.trim();
          
          ebMap.set(key, {
            id: participant.participantId.trim(),
            name: displayName,
            participantId: participant.participantId.trim(),
            participantName: participant.name?.trim() || '',
            role: participant.role?.trim() || '',
          });
        }
      }
    });

    // Convert map to array, filter out invalid entries, and sort by role
    return Array.from(ebMap.values())
      .filter(eb => eb.participantId && eb.participantId.length > 0)
      .sort((a, b) => a.role.localeCompare(b.role, 'pt-BR', { sensitivity: 'base' }));
  },
});

// Get unique CRs from all agParticipants for registration dropdown
export const getCRs = query({
  args: {},
  handler: async (ctx) => {
    const participants = await ctx.db
      .query("agParticipants")
      .filter((q) => q.eq(q.field("type"), "cr"))
      .collect();

    // Create a map to deduplicate CRs by participantId
    const crMap = new Map();
    
    participants.forEach(participant => {
      if (participant.participantId && participant.participantId.trim()) {
        const key = participant.participantId.trim();
        if (!crMap.has(key)) {
          // Format as [Role] - [Name]
          const displayName = participant.role && participant.role.trim() 
            ? `${participant.role.trim()} - ${participant.name.trim()}`
            : participant.name.trim();
          
          crMap.set(key, {
            id: participant.participantId.trim(),
            name: displayName,
            participantId: participant.participantId.trim(),
            participantName: participant.name?.trim() || '',
            role: participant.role?.trim() || '',
          });
        }
      }
    });

    // Convert map to array, filter out invalid entries, and sort by role
    return Array.from(crMap.values())
      .filter(cr => cr.participantId && cr.participantId.length > 0)
      .sort((a, b) => a.role.localeCompare(b.role, 'pt-BR', { sensitivity: 'base' }));
  },
});

// Get comprehensive registration analytics for an assembly - SUPER OPTIMIZED VERSION
export const getRegistrationAnalytics = query({
  args: { assemblyId: v.id("assemblies") },
  handler: async (ctx, args) => {
    // OPTIMIZATION 1: Parallel queries with proper indexing
    const [assemblyParticipants, assemblyRegistrations] = await Promise.all([
      // Get participants for this specific assembly only
      ctx.db
        .query("agParticipants")
        .withIndex("by_assembly", (q: any) => q.eq("assemblyId", args.assemblyId))
        .collect(),
      // Get registrations for this assembly only - using direct index
      ctx.db
        .query("agRegistrations")
        .withIndex("by_assembly", (q: any) => q.eq("assemblyId", args.assemblyId))
        .collect()
    ]);

    // OPTIMIZATION 2: Filter active registrations early
    const activeRegistrations = assemblyRegistrations.filter(r => 
      r.status !== "cancelled" && r.status !== "rejected"
    );

    // OPTIMIZATION 3: Use efficient data structures for lookups
    const registrationsByParticipantId = new Map<string, any[]>();
    
    activeRegistrations.forEach(reg => {
      // Build participant lookup map
      if (reg.participantId) {
        if (!registrationsByParticipantId.has(reg.participantId)) {
          registrationsByParticipantId.set(reg.participantId, []);
        }
        registrationsByParticipantId.get(reg.participantId)!.push(reg);
      }
    });

    // OPTIMIZATION 4: Process participants by type efficiently
    const participantsByType = new Map<string, any[]>();
    assemblyParticipants.forEach(p => {
      const key = `${p.type}-${p.status || 'default'}`;
      if (!participantsByType.has(key)) {
        participantsByType.set(key, []);
      }
      participantsByType.get(key)!.push(p);
    });

    // OPTIMIZATION 5: Process local comitês efficiently
    const comitesPlenos = participantsByType.get('comite-Pleno') || [];
    const comitesNaoPlenos = participantsByType.get('comite-Não-pleno') || [];
    
    // Deduplicate comitês by participantId
    const uniqueComitesPlenos = new Map();
    const uniqueComitesNaoPlenos = new Map();
    
    comitesPlenos.forEach(p => {
      if (!uniqueComitesPlenos.has(p.participantId)) {
        uniqueComitesPlenos.set(p.participantId, p);
      }
    });
    
    comitesNaoPlenos.forEach(p => {
      if (!uniqueComitesNaoPlenos.has(p.participantId)) {
        uniqueComitesNaoPlenos.set(p.participantId, p);
      }
    });

    // OPTIMIZATION 6: Calculate stats efficiently but INCLUDE details for compatibility
    const comitePlenoDetails = Array.from(uniqueComitesPlenos.values()).map(p => ({
      participantId: p.participantId,
      name: p.name,
      escola: p.escola,
      cidade: p.cidade,
      uf: p.uf,
      regional: p.regional,
      agFiliacao: p.agFiliacao,
      isRegistered: registrationsByParticipantId.has(p.participantId),
      registrationCount: registrationsByParticipantId.has(p.participantId) ? 
        registrationsByParticipantId.get(p.participantId)!.length : 0,
      registration: registrationsByParticipantId.has(p.participantId) ? 
        registrationsByParticipantId.get(p.participantId)![0] : null
    }));

    const comiteNaoPlenoDetails = Array.from(uniqueComitesNaoPlenos.values()).map(p => ({
      participantId: p.participantId,
      name: p.name,
      escola: p.escola,
      cidade: p.cidade,
      uf: p.uf,
      regional: p.regional,
      agFiliacao: p.agFiliacao,
      isRegistered: registrationsByParticipantId.has(p.participantId),
      registrationCount: registrationsByParticipantId.has(p.participantId) ? 
        registrationsByParticipantId.get(p.participantId)!.length : 0,
      registration: registrationsByParticipantId.has(p.participantId) ? 
        registrationsByParticipantId.get(p.participantId)![0] : null
    }));

    const comitePlenoRegistered = comitePlenoDetails.filter(d => d.isRegistered).length;
    const comiteNaoPlenoRegistered = comiteNaoPlenoDetails.filter(d => d.isRegistered).length;

    // OPTIMIZATION 7: Get EB and CR details efficiently (single query with full processing)
    const [globalEbDetails, globalCrDetails] = await Promise.all([
      ctx.db
        .query("agParticipants")
        .filter((q: any) => q.eq(q.field("type"), "eb"))
        .collect()
        .then(ebs => {
          // Deduplicate
          const uniqueEbs = new Map();
          ebs.forEach(participant => {
            if (participant.participantId && participant.participantId.trim()) {
              const key = participant.participantId.trim();
              if (!uniqueEbs.has(key)) {
                uniqueEbs.set(key, {
                  participantId: key,
                  name: participant.name?.trim() || '',
                  role: participant.role?.trim() || '',
                });
              }
            }
          });
          return Array.from(uniqueEbs.values()).map(p => ({
            participantId: p.participantId,
            name: p.name,
            role: p.role,
            isRegistered: registrationsByParticipantId.has(p.participantId),
            registration: registrationsByParticipantId.get(p.participantId)?.find(reg => 
              reg.participantType === 'eb'
            ) || null
          }));
        }),
      ctx.db
        .query("agParticipants")
        .filter((q: any) => q.eq(q.field("type"), "cr"))
        .collect()
        .then(crs => {
          // Deduplicate
          const uniqueCrs = new Map();
          crs.forEach(participant => {
            if (participant.participantId && participant.participantId.trim()) {
              const key = participant.participantId.trim();
              if (!uniqueCrs.has(key)) {
                uniqueCrs.set(key, {
                  participantId: key,
                  name: participant.name?.trim() || '',
                  role: participant.role?.trim() || '',
                });
              }
            }
          });
          return Array.from(uniqueCrs.values()).map(p => ({
            participantId: p.participantId,
            name: p.name,
            role: p.role,
            isRegistered: registrationsByParticipantId.has(p.participantId),
            registration: registrationsByParticipantId.get(p.participantId)?.find(reg => 
              reg.participantType === 'cr'
            ) || null
          }));
        })
    ]);

    // Count EB and CR registrations from this assembly's registrations
    const ebRegistrationCount = globalEbDetails.filter(d => d.isRegistered).length;
    const crRegistrationCount = globalCrDetails.filter(d => d.isRegistered).length;

    // OPTIMIZATION 8: Calculate other registrations efficiently
    const predefinedParticipantIds = new Set([
      ...Array.from(uniqueComitesPlenos.keys()),
      ...Array.from(uniqueComitesNaoPlenos.keys())
    ]);

    const otherRegistrations = activeRegistrations.filter(reg => 
      !predefinedParticipantIds.has(reg.participantId) && 
      reg.participantType !== 'eb' && 
      reg.participantType !== 'cr'
    );

    // Group other registrations by role
    const otherByRole = new Map<string, number>();
    otherRegistrations.forEach(reg => {
      const role = reg.participantRole || reg.participantType || 'unknown';
      otherByRole.set(role, (otherByRole.get(role) || 0) + 1);
    });

    // OPTIMIZATION 9: Return optimized response structure but with required details for compatibility
    const totalPredefined = uniqueComitesPlenos.size + uniqueComitesNaoPlenos.size + globalEbDetails.length + globalCrDetails.length;
    const totalRegisteredPredefined = comitePlenoRegistered + comiteNaoPlenoRegistered + ebRegistrationCount + crRegistrationCount;

    return {
      assemblyId: args.assemblyId,
      summary: {
        totalPredefinedParticipants: totalPredefined,
        totalRegisteredPredefined: totalRegisteredPredefined,
        totalActiveRegistrations: activeRegistrations.length,
        totalOtherRegistrations: otherRegistrations.length,
        overallRegistrationRate: totalPredefined > 0 ? (totalRegisteredPredefined / totalPredefined * 100) : 0,
      },
      // Include details for frontend compatibility
      comitesPlenos: {
        total: uniqueComitesPlenos.size,
        registered: comitePlenoRegistered,
        unregistered: uniqueComitesPlenos.size - comitePlenoRegistered,
        registrationRate: uniqueComitesPlenos.size > 0 ? (comitePlenoRegistered / uniqueComitesPlenos.size * 100) : 0,
        details: comitePlenoDetails
      },
      comitesNaoPlenos: {
        total: uniqueComitesNaoPlenos.size,
        registered: comiteNaoPlenoRegistered,
        unregistered: uniqueComitesNaoPlenos.size - comiteNaoPlenoRegistered,
        registrationRate: uniqueComitesNaoPlenos.size > 0 ? (comiteNaoPlenoRegistered / uniqueComitesNaoPlenos.size * 100) : 0,
        details: comiteNaoPlenoDetails
      },
      ebs: {
        total: globalEbDetails.length,
        registered: ebRegistrationCount,
        unregistered: globalEbDetails.length - ebRegistrationCount,
        registrationRate: globalEbDetails.length > 0 ? (ebRegistrationCount / globalEbDetails.length * 100) : 0,
        details: globalEbDetails
      },
      crs: {
        total: globalCrDetails.length,
        registered: crRegistrationCount,
        unregistered: globalCrDetails.length - crRegistrationCount,
        registrationRate: globalCrDetails.length > 0 ? (crRegistrationCount / globalCrDetails.length * 100) : 0,
        details: globalCrDetails
      },
      others: {
        total: otherRegistrations.length,
        byRole: Array.from(otherByRole.entries()).map(([role, count]) => ({
          role,
          count
        })),
        details: otherRegistrations
      },
      lastUpdated: Date.now()
    };
  },
}); 