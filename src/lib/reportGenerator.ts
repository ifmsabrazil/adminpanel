import * as XLSX from 'xlsx';

type AttendanceState = "present" | "absent" | "not-counting" | "excluded";

interface ReportData {
    ebs: any[];
    crs: any[];
    comitesPlenos: any[];
    comitesNaoPlenos: any[];
}

interface SessionData {
    name?: string;
    type?: string;
    attendanceRecords?: any[] | {
        ebs?: any[];
        crs?: any[];
        comites?: any[];
        participantes?: any[];
    };
}

interface AGParticipant {
    participantId: string;
    status: string;
}

/**
 * Return type for the generateAGReport function
 */
interface AGReportResult {
    /** Excel file buffer containing the generated report */
    buffer: ArrayBuffer;
    /** Filename for the generated Excel file */
    filename: string;
    /** Statistics about the generated report */
    stats: {
        /** Number of present participants (for session reports) */
        present?: number;
        /** Number of EBs in the report */
        ebs?: number;
        /** Number of CRs in the report */
        crs?: number;
        /** Number of full committees in the report */
        comitesPlenos?: number;
        /** Number of non-full committees in the report */
        comitesNaoPlenos?: number;
        /** Total number of participants in the report */
        total: number;
        /** Type of report generated */
        type: string;
        /** Name of the session (for session reports) */
        sessionName?: string;
    };
}

/**
 * Generates an Excel report for AG (Assembleia Geral) attendance data
 * 
 * This function creates comprehensive Excel reports with multiple worksheets containing
 * attendance data for different participant types (EBs, CRs, Committees) based on the
 * provided data and session type.
 * 
 * @param reportData - Base report data containing EBs, CRs, and committees information
 * @param sessionData - Optional session data containing attendance records for plenaria/sessao modes
 * @param sessionType - Type of session: "avulsa" (standalone), "plenaria" (plenary), or "sessao" (session)
 * @param agComitesParticipants - Optional array of committee participants with their status for proper classification
 * 
 * @returns AGReportResult object containing:
 *   - buffer: ArrayBuffer with the Excel file data
 *   - filename: Suggested filename for the generated report
 *   - stats: Statistics about the generated report including participant counts
 * 
 * @example
 * ```typescript
 * const result = generateAGReport(
 *   { ebs: [], crs: [], comitesPlenos: [], comitesNaoPlenos: [] },
 *   sessionData,
 *   "plenaria",
 *   agComitesParticipants
 * );
 * downloadReport(result.buffer, result.filename);
 * ```
 */
export const generateAGReport = (
    reportData: ReportData,
    sessionData?: SessionData,
    sessionType?: "avulsa" | "plenaria" | "sessao",
    agComitesParticipants?: AGParticipant[]
): AGReportResult => {
    try {
        // Create workbook
        const wb = XLSX.utils.book_new();
        
        // Helper function to create worksheet from data with error handling
        const createWorksheet = (data: any[], title: string) => {
            try {
                const ws = XLSX.utils.json_to_sheet(data);
                XLSX.utils.book_append_sheet(wb, ws, title);
            } catch (error) {
                console.error(`Error creating worksheet "${title}":`, error);
                throw new Error(`Failed to create worksheet "${title}": ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        };

        // Determine data source based on session type
        const isSessionMode = sessionType === "plenaria" || sessionType === "sessao";
        
        let finalReportData = {
            ebs: [] as any[],
            crs: [] as any[],
            comitesPlenos: [] as any[],
            comitesNaoPlenos: [] as any[]
        };

        if (isSessionMode && sessionData?.attendanceRecords) {
            // Use session attendance data for plenaria/sessao
            const sessionAttendance = sessionData.attendanceRecords;
            
            let ebs: any[] = [];
            let crs: any[] = [];
            let comites: any[] = [];
            let individuals: any[] = [];

            // Check if it's the object format (ebs, crs, comites, participantes) or flat array
            if (Array.isArray(sessionAttendance)) {
                // Flat array format - group by participant type
                console.log("Excel Report Debug (Session Mode - Array Format):", {
                    sessionType: sessionType,
                    sessionName: sessionData.name,
                    sessionAttendanceCount: sessionAttendance.length,
                    sampleRecords: sessionAttendance.slice(0, 3)
                });

                ebs = sessionAttendance.filter((r: any) => r.participantType === "eb");
                crs = sessionAttendance.filter((r: any) => r.participantType === "cr");
                comites = sessionAttendance.filter((r: any) => r.participantType === "comite" || r.participantType === "comite_local");
                individuals = sessionAttendance.filter((r: any) => r.participantType === "individual");
            } else {
                // Object format with separate arrays
                console.log("Excel Report Debug (Session Mode - Object Format):", {
                    sessionType: sessionType,
                    sessionName: sessionData.name,
                    hasEbs: !!(sessionAttendance as any).ebs,
                    hasCrs: !!(sessionAttendance as any).crs,
                    hasComites: !!(sessionAttendance as any).comites,
                    hasParticipantes: !!(sessionAttendance as any).participantes
                });

                ebs = (sessionAttendance as any).ebs || [];
                crs = (sessionAttendance as any).crs || [];
                comites = (sessionAttendance as any).comites || [];
                individuals = (sessionAttendance as any).participantes || [];
            }
            
            // Process EBs
            finalReportData.ebs = ebs.map((record: any) => ({
                'Tipo': 'EB',
                'Nome': record.participantName || record.name || 'N/A',
                'Cargo': record.participantRole || record.role || 'N/A',
                'Status': record.attendance === "present" ? "Presente" : 
                         record.attendance === "absent" ? "Ausente" : 
                         record.attendance === "excluded" ? "Excluído do quórum" : "Não contabilizado"
            }));
            
            // Process CRs
            finalReportData.crs = crs.map((record: any) => ({
                'Tipo': 'CR',
                'Nome': record.participantName || record.name || 'N/A',
                'Cargo': record.participantRole || record.role || 'N/A',
                'Status': record.attendance === "present" ? "Presente" : 
                         record.attendance === "absent" ? "Ausente" : 
                         record.attendance === "excluded" ? "Excluído do quórum" : "Não contabilizado"
            }));
            
            // Process Comitês - handle status separation properly
            if (sessionType === "plenaria" && agComitesParticipants) {
                // For plenárias, use agComitesParticipants to get proper committee status
                const comiteStatusMap = new Map();
                agComitesParticipants.forEach((comite: any) => {
                    comiteStatusMap.set(comite.participantId, comite.status);
                });

                comites.forEach((record: any) => {
                    // Get the proper status from agComitesParticipants
                    const properStatus = comiteStatusMap.get(record.participantId) || "Não-pleno";
                    
                    const comiteData = {
                        'Tipo': properStatus === "Pleno" ? 'Comitê Pleno' : 'Comitê Não-Pleno',
                        'Nome': record.participantName || record.name || 'N/A',
                        'Escola': record.participantSchool || record.escola || 'N/A',
                        'Regional': record.participantRegion || record.regional || 'N/A',
                        'Localização': record.participantLocation || `${record.cidade || 'N/A'}, ${record.uf || 'N/A'}`,
                        'Status': record.attendance === "present" ? "Presente" : 
                                 record.attendance === "absent" ? "Ausente" : 
                                 record.attendance === "excluded" ? "Excluído do quórum" : "Não contabilizado"
                    };

                    if (properStatus === "Pleno") {
                        finalReportData.comitesPlenos.push(comiteData);
                    } else {
                        finalReportData.comitesNaoPlenos.push(comiteData);
                    }
                });
            } else {
                // Fallback for non-plenária sessions or when agComitesParticipants is not available
                comites.forEach((record: any) => {
                    const comiteData = {
                        'Tipo': record.participantStatus === "Pleno" ? 'Comitê Pleno' : 'Comitê Não-Pleno',
                        'Nome': record.participantName || record.name || 'N/A',
                        'Escola': record.participantSchool || record.escola || 'N/A',
                        'Regional': record.participantRegion || record.regional || 'N/A',
                        'Localização': record.participantLocation || `${record.cidade || 'N/A'}, ${record.uf || 'N/A'}`,
                        'Status': record.attendance === "present" ? "Presente" : 
                                 record.attendance === "absent" ? "Ausente" : 
                                 record.attendance === "excluded" ? "Excluído do quórum" : "Não contabilizado"
                    };

                    if (record.participantStatus === "Pleno" || record.status === "Pleno") {
                        finalReportData.comitesPlenos.push(comiteData);
                    } else {
                        finalReportData.comitesNaoPlenos.push(comiteData);
                    }
                });
            }

            // Handle individual participants for sessions
            if (sessionType === "sessao") {
                if (individuals.length > 0) {
                    const individualParticipants = individuals.map((record: any) => ({
                        'Nome': record.participantName || 'N/A',
                        'Cargo/Função': record.participantRole || 'Participante',
                        'Comitê/Instituição': record.comiteLocal || '-',
                        'Email': record.email || '-',
                        'Email Solar': record.emailSolar || '-',
                        'CPF': record.cpf || '-',
                        'Celular': record.celular || '-',
                        'Cidade': record.cidade || '-',
                        'UF': record.uf || '-',
                        'ID': record.participantId || '-',
                        'Status': record.attendance === "present" ? "Presente" : 
                                 record.attendance === "absent" ? "Ausente" : 
                                 record.attendance === "excluded" ? "Excluído do quórum" : "Não contabilizado",
                        'Última Atualização': new Date(record.lastUpdated || record.markedAt).toLocaleString('pt-BR')
                    }));

                    // For sessions, create a single comprehensive worksheet
                    createWorksheet(individualParticipants, 'Participantes da Sessão');
                    
                    // Generate Excel file
                    let excelBuffer: ArrayBuffer;
                    try {
                        excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
                    } catch (error) {
                        console.error("Error generating Excel file for session:", error);
                        throw new Error(`Failed to generate Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    }
                    
                    return {
                        buffer: excelBuffer,
                        filename: `relatorio-presenca-sessao${sessionData?.name ? `-${sessionData.name.replace(/[^a-zA-Z0-9]/g, '_')}` : ''}-${new Date().toISOString().split('T')[0]}.xlsx`,
                        stats: {
                            present: individuals.filter((p: any) => p.attendance === "present").length,
                            total: individuals.length,
                            type: 'sessao',
                            sessionName: sessionData?.name
                        }
                    };
                }
            }
        } else {
            // Use provided report data for avulsa mode
            console.log("Excel Report Debug (Avulsa Mode):", {
                sessionType: sessionType || "avulsa",
                reportData
            });

            finalReportData = reportData;
        }

        // Create worksheets for standard reports (plenaria and avulsa)
        createWorksheet(finalReportData.ebs, 'Diretoria Executiva');
        createWorksheet(finalReportData.crs, 'Coordenadores Regionais');
        createWorksheet(finalReportData.comitesPlenos, 'Comitês Plenos');
        createWorksheet(finalReportData.comitesNaoPlenos, 'Comitês Não-Plenos');

        // Generate Excel file
        let excelBuffer: ArrayBuffer;
        try {
            excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        } catch (error) {
            console.error("Error generating Excel file:", error);
            throw new Error(`Failed to generate Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        
        // Calculate stats
        const totalCount = finalReportData.ebs.length + finalReportData.crs.length + 
                          finalReportData.comitesPlenos.length + finalReportData.comitesNaoPlenos.length;
        
        const sessionTypeLabel = isSessionMode ? 
            `${sessionType === "plenaria" ? "Plenária" : "Sessão"} "${sessionData?.name}"` : 
            "Chamada Avulsa";
        
        return {
            buffer: excelBuffer,
            filename: `relatorio-presenca-ag${sessionData?.name ? `-${sessionData.name.replace(/[^a-zA-Z0-9]/g, '_')}` : ''}-${new Date().toISOString().split('T')[0]}.xlsx`,
            stats: {
                ebs: finalReportData.ebs.length,
                crs: finalReportData.crs.length,
                comitesPlenos: finalReportData.comitesPlenos.length,
                comitesNaoPlenos: finalReportData.comitesNaoPlenos.length,
                total: totalCount,
                type: sessionTypeLabel
            }
        };
    } catch (error) {
        console.error("Error in generateAGReport:", error);
        throw new Error(`Failed to generate AG report: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
};

/**
 * Downloads a file from an ArrayBuffer with the specified filename
 * 
 * This function creates a blob from the provided buffer and triggers a download
 * in the browser. It includes comprehensive input validation and error handling.
 * 
 * @param buffer - The ArrayBuffer containing the file data
 * @param filename - The filename for the downloaded file
 * 
 * @throws {Error} When buffer is invalid or filename is empty
 * 
 * @example
 * ```typescript
 * try {
 *   downloadReport(excelBuffer, "relatorio.xlsx");
 * } catch (error) {
 *   console.error("Download failed:", error.message);
 * }
 * ```
 */
export const downloadReport = (buffer: ArrayBuffer, filename: string): void => {
    // Input validation
    if (!buffer || !(buffer instanceof ArrayBuffer)) {
        const error = new Error("Invalid buffer: buffer must be a valid ArrayBuffer");
        console.error("downloadReport validation error:", error);
        throw error;
    }

    if (!filename || typeof filename !== 'string' || filename.trim() === '') {
        const error = new Error("Invalid filename: filename must be a non-empty string");
        console.error("downloadReport validation error:", error);
        throw error;
    }

    try {
        // Create blob from buffer
        const dataBlob = new Blob([buffer], { 
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
        });
        
        downloadBlob(dataBlob, filename);
        console.log(`File "${filename}" downloaded successfully`);
    } catch (error) {
        console.error("Error during file download:", error);
        throw new Error(`Failed to download file "${filename}": ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
};

/**
 * Downloads a blob with the specified filename
 */
export const downloadBlob = (blob: Blob, filename: string): void => {
    if (!blob || !(blob instanceof Blob)) {
        const error = new Error("Invalid blob: blob must be a valid Blob");
        console.error("downloadBlob validation error:", error);
        throw error;
    }

    if (!filename || typeof filename !== 'string' || filename.trim() === '') {
        const error = new Error("Invalid filename: filename must be a non-empty string");
        console.error("downloadBlob validation error:", error);
        throw error;
    }

    // Sanitize filename to prevent security issues
    const sanitizedFilename = filename.replace(/[<>:"/\\|?*]/g, '_');

    try {
        // Create download link
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = sanitizedFilename;
        
        // Append link to DOM, trigger download, and clean up
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error("Error during file download:", error);
        throw new Error(`Failed to download file "${sanitizedFilename}": ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
};
